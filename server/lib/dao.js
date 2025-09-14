import { getDB } from './db.js';

/** Run once on boot for consistent behavior */
export function initDbPragmas() {
  const db = getDB();
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
}

export function insertSnapshot(graph, mermaid) {
  const db = getDB();
  const stmt = db.prepare(
    `INSERT INTO snapshots (graph, mermaid) VALUES (@graph, @mermaid)`
  );
  return stmt.run({ graph, mermaid });
}

export function getLatestSnapshot(graph) {
  const db = getDB();
  const row = db
    .prepare(
      `SELECT mermaid FROM snapshots
       WHERE graph = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(graph);
  return row?.mermaid || null;
}

export function getLatestSnapshotsAll() {
  return {
    dg: getLatestSnapshot('domain'),
    sg: getLatestSnapshot('syllabus'),
    pg: getLatestSnapshot('personal'),
  };
}

/** Utility: count nodes from Mermaid text (very naive) */
export function countNodesFromMermaid(mermaidText) {
  if (!mermaidText) return 0;
  // Count occurrences of ["] label blocks:  A["Label"]
  const matches = mermaidText.match(/\[[^\]]+\]/g);
  return matches ? matches.length : 0;
}
