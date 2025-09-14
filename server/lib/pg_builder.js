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
      const c = db.prepare(`SELECT id, label, norm_label, provenance FROM concepts WHERE id = ?`).get(h.concept_id);
      if (!c) continue;

      // Filter out structural course elements that shouldn't be in personal graph
      if (shouldFilterFromPersonalGraph(c)) {
        continue;
      }

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

    // Get domain edges that connect our personal concepts to other concepts
    const personalNorms = Array.from(masteredByNorm.keys());
    const personalNormSet = new Set(personalNorms);
    
    const domainEdges = db.prepare(`
      SELECT s.norm_label as s_norm, d.norm_label as d_norm, e.relation
      FROM edges e
      JOIN concepts s ON s.id = e.src_concept_id
      JOIN concepts d ON d.id = e.dst_concept_id
      WHERE e.source_graph = 'domain'
    `).all();

    // Filter to relevant edges: either both endpoints are personal, or at least one is
    const relevantEdges = domainEdges.filter(de => 
      personalNormSet.has(de.s_norm) || personalNormSet.has(de.d_norm)
    );

    // wipe old personal edges to keep PG tidy
    db.prepare(`DELETE FROM edges WHERE source_graph = 'personal'`).run();

    // assemble Mermaid with mild mastery styling
    const lines = ['graph TD;'];

    // define styles once at the top of the snapshot
    lines.push('classDef known fill:#1b5e20,stroke:#2e7d32,color:#ffffff;');    // green
    lines.push('classDef learning fill:#524600,stroke:#d4af37,color:#ffffff;'); // amber
    lines.push('classDef related fill:#37474f,stroke:#607d8b,color:#ffffff;');  // blue-grey for related concepts

    // Add all personal concepts with mastery styling
    for (const m of mastered) {
      const id = `P${String(masteredByNorm.get(m.norm_label).idx).padStart(3,'0')}`;
      lines.push(`  ${id}["${escapeLabel(m.label)}"]`);
      // attach class by mastery
      const cls = m.mastery === 'known' ? 'known' : 'learning';
      lines.push(`  class ${id} ${cls};`);
    }

    // Collect related concepts that aren't personal but connect to personal concepts
    const relatedConcepts = new Map();
    let relatedIndex = mastered.length + 1;
    const addedEdges = new Set(); // Track edges to avoid duplicates

    for (const de of relevantEdges) {
      const sPersonal = masteredByNorm.get(de.s_norm);
      const dPersonal = masteredByNorm.get(de.d_norm);
      
      // If both are personal, create direct edge
      if (sPersonal && dPersonal) {
        const sid = `P${String(sPersonal.idx).padStart(3,'0')}`;
        const did = `P${String(dPersonal.idx).padStart(3,'0')}`;
        const edgeKey = `${sid}-${did}-${de.relation}`;
        
        if (!addedEdges.has(edgeKey)) {
          addedEdges.add(edgeKey);
          if (de.relation === 'relates_to') {
            lines.push(`  ${sid} --- ${did}`);
          } else if (de.relation === 'part_of') {
            lines.push(`  ${sid} -->|part_of| ${did}`);
          } else {
            lines.push(`  ${sid} --> ${did}`);
          }

          // persist as personal edge
          db.prepare(`
            INSERT INTO edges (src_concept_id, dst_concept_id, relation, source_graph)
            VALUES (?, ?, ?, 'personal')
          `).run(sPersonal.id, dPersonal.id, de.relation);
        }
      }
      // If only one is personal, add the related concept
      else if (sPersonal && !dPersonal) {
        if (!relatedConcepts.has(de.d_norm)) {
          const relatedId = `R${String(relatedIndex++).padStart(3,'0')}`;
          relatedConcepts.set(de.d_norm, { id: relatedId, label: de.d_norm });
          lines.push(`  ${relatedId}["${escapeLabel(de.d_norm)}"]`);
          lines.push(`  class ${relatedId} related;`);
        }
        const sid = `P${String(sPersonal.idx).padStart(3,'0')}`;
        const rid = relatedConcepts.get(de.d_norm).id;
        const edgeKey = `${sid}-${rid}-${de.relation}`;
        
        if (!addedEdges.has(edgeKey)) {
          addedEdges.add(edgeKey);
          if (de.relation === 'relates_to') {
            lines.push(`  ${sid} --- ${rid}`);
          } else if (de.relation === 'part_of') {
            lines.push(`  ${sid} -->|part_of| ${rid}`);
          } else {
            lines.push(`  ${sid} --> ${rid}`);
          }
        }
      }
      else if (!sPersonal && dPersonal) {
        if (!relatedConcepts.has(de.s_norm)) {
          const relatedId = `R${String(relatedIndex++).padStart(3,'0')}`;
          relatedConcepts.set(de.s_norm, { id: relatedId, label: de.s_norm });
          lines.push(`  ${relatedId}["${escapeLabel(de.s_norm)}"]`);
          lines.push(`  class ${relatedId} related;`);
        }
        const rid = relatedConcepts.get(de.s_norm).id;
        const did = `P${String(dPersonal.idx).padStart(3,'0')}`;
        const edgeKey = `${rid}-${did}-${de.relation}`;
        
        if (!addedEdges.has(edgeKey)) {
          addedEdges.add(edgeKey);
          if (de.relation === 'relates_to') {
            lines.push(`  ${rid} --- ${did}`);
          } else if (de.relation === 'part_of') {
            lines.push(`  ${rid} -->|part_of| ${did}`);
          } else {
            lines.push(`  ${rid} --> ${did}`);
          }
        }
      }
    }

    const mm = lines.join('\n');
    insertSnapshot('personal', mm);
    db.exec('COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK;');
    throw e;
  }
}

/** Filter out structural course elements that shouldn't appear in personal graph */
function shouldFilterFromPersonalGraph(concept) {
  const label = concept.label?.toLowerCase() || '';

  // Filter out course structure elements
  if (label.startsWith('module:') ||
      label.startsWith('page:') ||
      label.startsWith('file:') ||
      label.startsWith('assignment:') ||
      label.startsWith('outcome:') ||
      label.startsWith('course:')) {
    return true;
  }

  // Filter based on provenance (syllabus structure elements)
  if (concept.provenance) {
    try {
      const prov = JSON.parse(concept.provenance);
      if (prov.type === 'module_item' ||
          prov.type === 'page' ||
          prov.type === 'page_heading' ||
          prov.type === 'assignment' ||
          prov.type === 'outcome' ||
          prov.type === 'file' ||
          prov.type === 'file_page') {
        return true;
      }
    } catch {
      // Invalid JSON, continue with label-based filtering
    }
  }

  return false;
}

function escapeLabel(s) {
  return String(s).replace(/"/g, '\\"');
}

