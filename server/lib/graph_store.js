import { getDB } from './db.js';
import { parseMermaid, normalizeLabel } from './mermaid.js';
import { insertSnapshot } from './dao.js';


function upsertConcept(db, { label, source_graph, description = null, provenance = null }) {
  const norm = normalizeLabel(label);
  const sel = db.prepare(
    `SELECT id FROM concepts WHERE norm_label = ? AND source_graph = ? LIMIT 1`
  ).get(norm, source_graph);

  if (sel?.id) return sel.id;

  const ins = db.prepare(
    `INSERT INTO concepts (label, norm_label, description, source_graph, provenance)
     VALUES (@label, @norm_label, @description, @source_graph, @provenance)`
  );
  const r = ins.run({
    label,
    norm_label: norm,
    description,
    source_graph,
    provenance
  });
  return r.lastInsertRowid;
}

function insertEdge(db, { srcId, dstId, relation, source_graph }) {
  const stmt = db.prepare(
    `INSERT INTO edges (src_concept_id, dst_concept_id, relation, source_graph)
     VALUES (?, ?, ?, ?)`
  );
  stmt.run(srcId, dstId, relation, source_graph);
}

export function ingestDomainMermaid(mermaidText) {
  const db = getDB();
  const { nodes, edges } = parseMermaid(mermaidText);

  db.exec('BEGIN;');
  try {
    insertSnapshot('domain', mermaidText);

    // map mermaid node IDs => DB concept IDs
    const idMap = new Map(); // mermaidId -> conceptId
    for (const n of nodes) {
      const conceptId = upsertConcept(db, {
        label: n.label,
        source_graph: 'domain'
      });
      idMap.set(n.id, conceptId);
    }

    // edges (no dedup for now)
    for (const e of edges) {
      const s = idMap.get(e.srcId);
      const d = idMap.get(e.dstId);
      if (s && d) insertEdge(db, { srcId: s, dstId: d, relation: e.relation, source_graph: 'domain' });
    }

    db.exec('COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK;');
    throw e;
  }
}

export function ingestSyllabusMermaid(mermaidText, meta = []) {
  const db = getDB();
  const { nodes, edges } = parseMermaid(mermaidText);

  db.exec('BEGIN;');
  try {
    insertSnapshot('syllabus', mermaidText);

    const idMap = new Map();
    for (const n of nodes) {
      const conceptId = upsertConcept(db, {
        label: n.label,
        source_graph: 'syllabus'
      });
      idMap.set(n.id, conceptId);
    }
    for (const e of edges) {
      const s = idMap.get(e.srcId);
      const d = idMap.get(e.dstId);
      if (s && d) insertEdge(db, { srcId: s, dstId: d, relation: e.relation, source_graph: 'syllabus' });
    }

    // Apply provenance by matching on norm_label
    if (meta?.length) {
      const upd = db.prepare(`UPDATE concepts SET provenance = @prov WHERE id = @id`);
      for (const m of meta) {
        const norm = normalizeLabel(m.label);
        const row = db.prepare(`SELECT id FROM concepts WHERE source_graph='syllabus' AND norm_label=? LIMIT 1`).get(norm);
        if (!row) continue;
        upd.run({ id: row.id, prov: JSON.stringify(m.provenance) });
      }
    }

    db.exec('COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK;');
    throw e;
  }
}