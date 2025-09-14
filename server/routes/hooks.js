import { Router } from 'express';
import { detectConceptMentions, thresholds } from '../lib/extract.js';
import { applyEvidenceAndRebuildPG } from '../lib/pg_builder.js';
import { runExactAlignments } from '../lib/align.js';

const router = Router();

/**
 * POST /hooks/chat
 * Body: { sessionId?: number, role: 'user'|'assistant', text: string, topicHint?: string }
 * - We score only 'user' turns by default (assistant explanations don't count as learner mastery).
 */
router.post('/hooks/chat', async (req, res) => {
  const { role, text, topicHint } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });

  // Only count user messages toward mastery (can change if you prefer)
  if (role && String(role).toLowerCase() !== 'user') {
    return res.json({ ok: true, hits: [], skipped: true });
  }

  try {
    const hits = await detectConceptMentions({ text, topicHint });
    if (hits.length === 0) {
      return res.json({
        ok: true,
        hits: [],
        thresholds,
        note: 'no concepts detected this turn'
      });
    }

    applyEvidenceAndRebuildPG({ hits });
    runExactAlignments(); // refresh overlaps

    res.json({
      ok: true,
      detected: hits.length,
      thresholds,
      sample: hits.slice(0, 5)
    });
  } catch (e) {
    console.error('[hooks/chat] failed', e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
