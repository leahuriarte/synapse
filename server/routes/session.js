import { Router } from 'express';
import { getDB } from '../lib/db.js';

const router = Router();

router.post('/session/start', (req, res) => {
  const { topic } = req.body || {};
  if (!topic || !topic.trim()) return res.status(400).json({ error: 'topic required' });

  const db = getDB();
  const r = db.prepare(`INSERT INTO sessions (topic) VALUES (?)`).run(topic.trim());
  return res.json({ sessionId: r.lastInsertRowid, topic: topic.trim() });
});

export default router;
