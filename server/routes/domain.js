import { Router } from 'express';
import { ingestDomainMermaid } from '../lib/graph_store.js';
import { hasAnthropic, generateDomainMermaid } from '../lib/llm.js';
import { runExactAlignments } from '../lib/align.js';   // ⬅️ add

const router = Router();

router.post('/graph/domain/build', async (req, res) => {
  const { topic } = req.body || {};
  if (!topic || !topic.trim()) return res.status(400).json({ error: 'topic required' });
  if (!hasAnthropic) {
    return res.status(400).json({
      error: 'LLM not configured',
      hint: 'Set ANTHROPIC_API_KEY in .env or use /graph/domain/ingest'
    });
  }
  try {
    const mermaid = await generateDomainMermaid(topic.trim());
    ingestDomainMermaid(mermaid);
    runExactAlignments();                    // ⬅️ run after updates
    res.json({ ok: true, mermaid });
  } catch (e) {
    console.error('[domain/build] failed', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/graph/domain/ingest', (req, res) => {
  const { mermaid } = req.body || {};
  if (!mermaid || !mermaid.trim()) return res.status(400).json({ error: 'mermaid required' });
  try {
    ingestDomainMermaid(mermaid);
    runExactAlignments();                    // ⬅️ run after updates
    res.json({ ok: true });
  } catch (e) {
    console.error('[domain/ingest] failed', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
