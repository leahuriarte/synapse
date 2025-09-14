import { getDB } from './db.js';
import { parseMermaid, normalizeLabel } from './mermaid.js';
import { insertSnapshot } from './dao.js';

const LEARNING_THRESHOLD = Number(process.env.PG_LEARNING_THRESHOLD ?? 0.55);
const KNOWN_THRESHOLD = Number(process.env.PG_KNOWN_THRESHOLD ?? 0.78);
const PG_MAX_NODES = Number(process.env.PG_MAX_NODES ?? 250);

/** Upsert a 'personal' concept row by norm_label; returns concept_id. */
function upsertPersonalConcept(db, label) {
  const norm = normalizeLabel(label);
  const sel = db.prepare(
    `SELECT id FROM concepts WHERE norm_label = ? AND source_graph = 'personal' LIMIT 1`
  ).get(norm);
  if (sel?.id) return sel.id;

  const ins = db.prepare(
    `INSERT INTO concepts (label, norm_label, description, source_graph, provenance)
     VALUES (@label, @norm_label, NULL, 'personal', NULL)`
  );
  const r = ins.run({ label, norm_label: norm });
  return r.lastInsertRowid;
}

/** Update progress (learning/known) from evidence row. */
function updateProgress(db, conceptId, confidence) {
  const sel = db.prepare(`SELECT mastery, score FROM progress WHERE concept_id = ?`).get(conceptId);

  if (!sel) {
    if (confidence >= LEARNING_THRESHOLD) {
      db.prepare(`
        INSERT INTO progress (concept_id, mastery, score)
        VALUES (?, 'learning', ?)
      `).run(conceptId, confidence);
    }
    return;
  }

  // accumulate simple max-score; promote when threshold met
  const newScore = Math.max(Number(sel.score ?? 0), confidence);

  if (sel.mastery === 'unknown' && confidence >= LEARNING_THRESHOLD) {
    db.prepare(`UPDATE progress SET mastery='learning', score=?, last_updated=datetime('now') WHERE concept_id=?`)
      .run(newScore, conceptId);
  } else if (sel.mastery === 'learning' && confidence >= KNOWN_THRESHOLD) {
    db.prepare(`UPDATE progress SET mastery='known', score=?, last_updated=datetime('now') WHERE concept_id=?`)
      .run(newScore, conceptId);
  } else {
    db.prepare(`UPDATE progress SET score=?, last_updated=datetime('now') WHERE concept_id=?`)
      .run(newScore, conceptId);
  }
}

/** Persist evidence and reflect into progress + personal concepts. */
export function applyEvidenceAndRebuildPG({ hits }) {
  const db = getDB();

  // 1) turn DG/SG concept labels into 'personal' concepts
  //    (create a personal mirror node for each mentioned label)
  const personalConceptIds = [];

  db.exec('BEGIN;');
  try {
    for (const h of hits) {
      // fetch the canonical label for the mentioned concept id
      const c = db.prepare(`SELECT id, label, norm_label FROM concepts WHERE id = ?`).get(h.concept_id);
      if (!c) continue;

      const pId = upsertPersonalConcept(db, c.label);
      personalConceptIds.push(pId);

      // write evidence tied to the personal concept row
      db.prepare(`
        INSERT INTO evidence (concept_id, kind, payload, confidence)
        VALUES (?, 'chat', @payload, @conf)
      `).run(pId, {
        payload: JSON.stringify({ from: 'chat', norm_label: c.norm_label }),
        conf: h.confidence
      });

      // update mastery
      updateProgress(db, pId, h.confidence);
    }

    // 2) build PG edges by projecting DG edges where both endpoints have
    //    corresponding personal nodes present (by norm_label)
    const mastered = db.prepare(`
      SELECT c.id, c.label, c.norm_label, p.mastery
      FROM progress p
      JOIN concepts c ON c.id = p.concept_id
      WHERE c.source_graph = 'personal' AND p.mastery IN ('learning','known')
      ORDER BY p.mastery DESC, c.label
      LIMIT ?
    `).all(PG_MAX_NODES);

    // index mastered by norm label
    const masteredByNorm = new Map();
    mastered.forEach((m, i) => masteredByNorm.set(m.norm_label, { ...m, idx: i + 1 }));

    // domain edges projected
    const domainEdges = db.prepare(`
      SELECT s.norm_label as s_norm, d.norm_label as d_norm, e.relation
      FROM edges e
      JOIN concepts s ON s.id = e.src_concept_id
      JOIN concepts d ON d.id = e.dst_concept_id
      WHERE e.source_graph = 'domain'
    `).all();

    // wipe old personal edges to keep PG tidy
    db.prepare(`DELETE FROM edges WHERE source_graph = 'personal'`).run();

    // assemble Mermaid with mild mastery styling
    const lines = ['graph TD;'];

    // define styles once at the top of the snapshot
    lines.push('classDef known fill:#1b5e20,stroke:#2e7d32,color:#ffffff;');    // green
    lines.push('classDef learning fill:#524600,stroke:#d4af37,color:#ffffff;'); // amber

    for (const m of mastered) {
      const id = `P${String(masteredByNorm.get(m.norm_label).idx).padStart(3,'0')}`;
      lines.push(`  ${id}["${escapeLabel(m.label)}"]`);
      // attach class by mastery
      const cls = m.mastery === 'known' ? 'known' : 'learning';
      lines.push(`  class ${id} ${cls};`);
    }

    // edges (unchanged)
    for (const de of domainEdges) {
      const s = masteredByNorm.get(de.s_norm);
      const d = masteredByNorm.get(de.d_norm);
      if (!s || !d) continue;
      const sid = `P${String(s.idx).padStart(3,'0')}`;
      const did = `P${String(d.idx).padStart(3,'0')}`;
      if (de.relation === 'relates_to') {
        lines.push(`  ${sid} --- ${did}`);
      } else if (de.relation === 'part_of') {
        lines.push(`  ${sid} -->|part_of| ${did}`);
      } else {
        lines.push(`  ${sid} --> ${did}`);
      }

      // persist as personal edge (unchanged)
      const srcId = s.id, dstId = d.id;
      db.prepare(`
        INSERT INTO edges (src_concept_id, dst_concept_id, relation, source_graph)
        VALUES (?, ?, ?, 'personal')
      `).run(srcId, dstId, de.relation);
    }

    const mm = lines.join('\n');
    insertSnapshot('personal', mm);
    db.exec('COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK;');
    throw e;
  }
}

function escapeLabel(s) {
  return String(s).replace(/"/g, '\\"');
}
