import { getDB } from './db.js';
import { anthropicClient, hasAnthropic } from './llm.js';
import { normalizeLabel } from './mermaid.js';

const LEARNING_THRESHOLD = Number(process.env.PG_LEARNING_THRESHOLD ?? 0.55);
const KNOWN_THRESHOLD = Number(process.env.PG_KNOWN_THRESHOLD ?? 0.78);

/** Load candidate concepts from DG and SG (id, label, norm_label, source_graph). */
function loadCatalog() {
  const db = getDB();
  return db.prepare(`
    SELECT id, label, norm_label, source_graph
    FROM concepts
    WHERE source_graph IN ('domain','syllabus')
  `).all();
}

/** Exact-ish match by normalized inclusion (very fast, works well for many labels). */
function exactMentions(text, catalog) {
  const normText = normalizeLabel(text); // spaces/punct normalized
  const hits = [];
  const seen = new Set();
  for (const c of catalog) {
    if (!c.norm_label) continue;
    if (seen.has(c.norm_label)) continue;
    // require whole-word-ish inclusion (cheap heuristic)
    const needle = ` ${c.norm_label} `;
    const hay = ` ${normText} `;
    if (hay.includes(needle)) {
      hits.push({
        concept_id: c.id,
        norm_label: c.norm_label,
        label: c.label,
        confidence: Math.max(LEARNING_THRESHOLD, 0.6) // exact mention ≈ decent confidence
      });
      seen.add(c.norm_label);
    }
  }
  return hits;
}

/** Optional LLM assist when exact mentions are empty but text shows mastery signals. */
async function llmInferMentions(text, catalog, topicHint = '') {
  if (!hasAnthropic) return [];
  const client = anthropicClient();

  const topLabels = catalog
    .slice(0, 500) // keep prompt bounded
    .map(c => c.label)
    .join(' | ');

  const sys = `Identify which of the following topic labels the learner has *demonstrated* knowledge of.
Return ONLY compact JSON array: [{"label":"...","confidence":0..1,"why":"..."}]
Be conservative: only include labels if the learner showed recall+reasoning.`;

  const usr = `Topic: ${topicHint || '(unspecified)'}
Candidate labels (subset allowed): ${topLabels}
Learner message:
"""
${text}
"""`;

  const msg = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    temperature: 0.1,
    max_tokens: 800,
    system: sys,
    messages: [{ role: 'user', content: usr }]
  });

  const raw = (msg.content?.[0]?.text || '').trim();
  const json = safeJson(raw);
  if (!Array.isArray(json)) return [];

  // map back to catalog by normalized label
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
    const conf = Number(it.confidence ?? 0.6);
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
  const exact = exactMentions(text, catalog);
  if (exact.length) return exact;

  // Only fire LLM if exact gave nothing
  const llm = await llmInferMentions(text, catalog, topicHint);
  return llm.filter(x => x.confidence >= LEARNING_THRESHOLD);
}

export const thresholds = { LEARNING_THRESHOLD, KNOWN_THRESHOLD };
