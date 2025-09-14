// Enhanced concept detection for server/lib/extract.js
// Replace the existing detectConceptMentions function with this enhanced version

import { getDB } from './db.js';
import { anthropicClient, hasAnthropic } from './llm.js';
import { normalizeLabel } from './mermaid.js';

const LEARNING_THRESHOLD = Number(process.env.PG_LEARNING_THRESHOLD ?? 0.55);
const KNOWN_THRESHOLD = Number(process.env.PG_KNOWN_THRESHOLD ?? 0.78);

// Enhanced learning mode - more aggressive concept detection
// Use global to persist across module reloads
if (!global.SYNAPSE_LEARNING_MODE) {
  global.SYNAPSE_LEARNING_MODE = true; // Default to enabled for learning sessions
}

export function enableLearningMode() {
  global.SYNAPSE_LEARNING_MODE = true;
  console.log('🎓 Learning mode enabled - aggressive concept detection active');
}

export function disableLearningMode() {
  global.SYNAPSE_LEARNING_MODE = false;
  console.log('📖 Learning mode disabled - normal concept detection');
}

export function isLearningModeEnabled() {
  return global.SYNAPSE_LEARNING_MODE;
}

/** Load candidate concepts from DG and SG (id, label, norm_label, source_graph). */
function loadCatalog() {
  const db = getDB();
  return db.prepare(`
    SELECT id, label, norm_label, source_graph
    FROM concepts
    WHERE source_graph IN ('domain','syllabus')
  `).all();
}

/** Enhanced exact-ish match - more liberal in learning mode */
function exactMentions(text, catalog) {
  const normText = normalizeLabel(text);
  const hits = [];
  const seen = new Set();
  
  for (const c of catalog) {
    if (!c.norm_label) continue;
    if (seen.has(c.norm_label)) continue;
    
    let confidence = 0;
    let found = false;
    
    if (global.SYNAPSE_LEARNING_MODE) {
      // In learning mode, be more aggressive about detecting mentions
      
      // Exact match (high confidence)
      const needle = ` ${c.norm_label} `;
      const hay = ` ${normText} `;
      if (hay.includes(needle)) {
        confidence = Math.max(LEARNING_THRESHOLD + 0.1, 0.7);
        found = true;
      }
      
      // Partial match for compound terms (medium confidence)
      if (!found && c.norm_label.includes(' ')) {
        const words = c.norm_label.split(' ');
        const foundWords = words.filter(word => 
          word.length > 3 && normText.includes(word)
        );
        if (foundWords.length >= Math.ceil(words.length * 0.6)) {
          confidence = LEARNING_THRESHOLD + 0.05;
          found = true;
        }
      }
      
      // Single word substring match (lower confidence)
      if (!found && c.norm_label.length > 4 && normText.includes(c.norm_label)) {
        confidence = LEARNING_THRESHOLD;
        found = true;
      }
      
      // Fuzzy matching for similar terms
      if (!found) {
        const similarity = calculateSimilarity(c.norm_label, normText);
        if (similarity > 0.7) {
          confidence = LEARNING_THRESHOLD;
          found = true;
        }
      }
      
    } else {
      // Normal mode - conservative detection
      const needle = ` ${c.norm_label} `;
      const hay = ` ${normText} `;
      if (hay.includes(needle)) {
        confidence = Math.max(LEARNING_THRESHOLD, 0.6);
        found = true;
      }
    }
    
    if (found) {
      hits.push({
        concept_id: c.id,
        norm_label: c.norm_label,
        label: c.label,
        confidence: confidence
      });
      seen.add(c.norm_label);
    }
  }
  
  return hits;
}

/** Simple string similarity calculation */
function calculateSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const matches = longestCommonSubsequence(longer, shorter);
  return matches.length / longer.length;
}

function longestCommonSubsequence(str1, str2) {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
  
  for (let i = 0; i <= str2.length; i += 1) {
    for (let j = 0; j <= str1.length; j += 1) {
      if (i === 0 || j === 0) {
        matrix[i][j] = '';
      } else if (str2[i - 1] === str1[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1] + str2[i - 1];
      } else {
        matrix[i][j] = matrix[i - 1][j].length > matrix[i][j - 1].length 
          ? matrix[i - 1][j] 
          : matrix[i][j - 1];
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

/** Enhanced LLM inference with learning mode context */
async function llmInferMentions(text, catalog, topicHint = '') {
  if (!hasAnthropic) return [];
  const client = anthropicClient();

  const topLabels = catalog
    .slice(0, 500)
    .map(c => c.label)
    .join(' | ');

  let systemPrompt = `Identify which of the following topic labels the learner has *demonstrated* knowledge of or *mentioned* in their message.`;
  
  if (global.SYNAPSE_LEARNING_MODE) {
    systemPrompt = `You are in LEARNING MODE. Identify which of the following topic labels the learner has mentioned, discussed, asked about, or shown any familiarity with. Be liberal in detection - if they mention a concept even in passing, include it.`;
  }

  systemPrompt += `
Return ONLY compact JSON array: [{"label":"...","confidence":0..1,"why":"..."}]
${global.SYNAPSE_LEARNING_MODE ? 'In learning mode: err on the side of inclusion.' : 'Be conservative: only include labels if clearly demonstrated.'}`;

  const usr = `Topic: ${topicHint || '(unspecified)'}
Candidate labels (subset allowed): ${topLabels}
Learner message:
"""
${text}
"""`;

  const msg = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    temperature: global.SYNAPSE_LEARNING_MODE ? 0.3 : 0.1,  // Slightly higher temperature in learning mode
    max_tokens: 800,
    system: systemPrompt,
    messages: [{ role: 'user', content: usr }]
  });

  const raw = (msg.content?.[0]?.text || '').trim();
  const json = safeJson(raw);
  if (!Array.isArray(json)) return [];

  // Map back to catalog by normalized label
  const byNorm = new Map();
  for (const c of catalog) {
    if (!byNorm.has(c.norm_label)) byNorm.set(c.norm_label, []);
    byNorm.get(c.norm_label).push(c);
  }

  const out = [];
  for (const it of json) {
    if (!it?.label) continue;
    const norm = normalizeLabel(String(it.label));
    const candidates = byNorm.get(norm);
    if (!candidates?.length) continue;
    
    let conf = Number(it.confidence ?? 0.6);
    
    // In learning mode, boost confidence for any detection
    if (global.SYNAPSE_LEARNING_MODE && conf > 0) {
      conf = Math.max(conf, LEARNING_THRESHOLD);
    }
    
    for (const c of candidates) {
      out.push({
        concept_id: c.id,
        norm_label: c.norm_label,
        label: c.label,
        confidence: conf
      });
    }
  }
  return out;
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

export async function detectConceptMentions({ text, topicHint = '' }) {
  const catalog = loadCatalog();
  
  // Try exact mentions first
  const exact = exactMentions(text, catalog);
  
  // In learning mode, always try LLM too (not just as fallback)
  if (global.SYNAPSE_LEARNING_MODE) {
    const llm = await llmInferMentions(text, catalog, topicHint);
    
    // Combine exact and LLM results, dedup by norm_label
    const seen = new Set(exact.map(h => h.norm_label));
    const combined = [...exact];
    
    for (const hit of llm) {
      if (!seen.has(hit.norm_label)) {
        combined.push(hit);
        seen.add(hit.norm_label);
      }
    }
    
    return combined.filter(x => x.confidence >= LEARNING_THRESHOLD);
  } else {
    // Normal mode - exact first, LLM as fallback
    if (exact.length > 0) return exact;
    
    const llm = await llmInferMentions(text, catalog, topicHint);
    return llm.filter(x => x.confidence >= LEARNING_THRESHOLD);
  }
}

export const thresholds = { LEARNING_THRESHOLD, KNOWN_THRESHOLD };