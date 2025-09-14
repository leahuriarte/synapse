import { Router } from 'express';
import { runExactAlignments, countOverlaps, countOverlapsAligned } from '../lib/align.js';
import { runEmbeddingAlignments } from '../lib/embeddings.js';

const router = Router();

router.post('/align/exact', (_req, res) => {
  try { runExactAlignments(); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

router.post('/align/embedding', async (_req, res) => {
  try {
    const out = await runEmbeddingAlignments();
    // Chain exact too (in case new PG nodes were created)
    runExactAlignments();
    // report both counters
    res.json({ ok: true, built: out, overlaps_raw: countOverlaps(), overlaps_aligned: countOverlapsAligned() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
