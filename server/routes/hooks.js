import { Router } from 'express';
import { detectConceptMentions, thresholds } from '../lib/extract.js';
import { applyEvidenceAndRebuildPG } from '../lib/pg_builder.js';
import { runExactAlignments } from '../lib/align.js';
import { enableLearningMode, disableLearningMode } from '../lib/extract.js';
import { getDB } from '../lib/db.js';

const router = Router();

// Enable aggressive concept detection for learning sessions
router.post('/learning-mode/enable', (req, res) => {
  try {
    enableLearningMode();
    res.json({ 
      ok: true, 
      mode: 'learning',
      message: 'Aggressive concept detection enabled - all mentions will be tracked'
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Disable aggressive concept detection
router.post('/learning-mode/disable', (req, res) => {
  try {
    disableLearningMode();
    res.json({ 
      ok: true, 
      mode: 'normal',
      message: 'Conservative concept detection enabled'
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Get current learning mode status
router.get('/learning-mode/status', (req, res) => {
  try {
    // You'll need to export the LEARNING_MODE state from extract.js
    res.json({ 
      ok: true,
      learning_mode: global.SYNAPSE_LEARNING_MODE || false
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Main chat hook endpoint with enhanced learning mode support
router.post('/hooks/chat', async (req, res) => {
  const { role, text, topicHint, workspace, sessionId, timestamp, toolUsed } = req.body || {};

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'text required' });
  }

  const cleanText = text.trim();
  const effectiveRole = (role || 'user').toLowerCase();

  try {
    let hits = [];
    let processingNote = '';

    // Always try to detect concepts from both user and assistant messages in learning mode
    if (effectiveRole === 'user' || effectiveRole === 'assistant') {
      hits = await detectConceptMentions({ text: cleanText, topicHint });

      if (hits.length > 0) {
        processingNote = `Detected ${hits.length} concept mentions from ${effectiveRole}`;
      } else {
        processingNote = effectiveRole === 'user'
          ? 'No concept mastery detected in user message'
          : 'No teaching concepts detected in assistant message';
      }
    } else if (effectiveRole === 'system') {
      processingNote = 'System event logged';
    }

    // Store the interaction
    const db = getDB();
    db.prepare(`
      INSERT INTO events (type, payload, ts)
      VALUES ('chat_interaction', ?, datetime('now'))
    `).run(JSON.stringify({
      role: effectiveRole,
      text: cleanText,
      topicHint,
      workspace,
      sessionId,
      timestamp: timestamp || new Date().toISOString(),
      toolUsed,
      conceptsDetected: hits.length,
      processingNote
    }));

    // Update knowledge graphs if we detected learning
    if (hits.length > 0) {
      applyEvidenceAndRebuildPG({ hits });
      runExactAlignments();
    }

    // Return detailed response
    const response = {
      ok: true,
      role: effectiveRole,
      detected: hits.length,
      thresholds,
      processingNote,
      workspace: workspace || 'unknown',
      timestamp: timestamp || new Date().toISOString()
    };

    // Include sample concepts for debugging
    if (hits.length > 0) {
      response.sample = hits.slice(0, 5).map(h => ({
        label: h.label,
        confidence: h.confidence,
        norm_label: h.norm_label
      }));
    }

    res.json(response);

  } catch (e) {
    console.error('[hooks/chat] failed', e);

    // Still try to log the event even if processing failed
    try {
      const db = getDB();
      db.prepare(`
        INSERT INTO events (type, payload, ts)
        VALUES ('chat_error', ?, datetime('now'))
      `).run(JSON.stringify({
        role: effectiveRole,
        text: cleanText,
        error: e.message,
        workspace,
        sessionId
      }));
    } catch (logError) {
      console.error('[hooks/chat] logging failed too', logError);
    }

    res.status(500).json({
      ok: false,
      error: String(e?.message || e),
      role: effectiveRole
    });
  }
});

export default router;