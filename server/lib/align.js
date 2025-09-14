import { getDB } from './db.js';


function singularize(word) {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';        // categories -> category
  if (word.endsWith('ses')) return word.slice(0, -2);              // processes -> process
  if (word.endsWith('xes')) return word.slice(0, -2);              // indexes -> index
  if (word.endsWith('zes')) return word.slice(0, -2);              // analyses -> analys(e)z? (good enough)
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1); // functions -> function
  return word;
}
function singularNorm(norm) {
  const parts = String(norm).split(' ');
  if (!parts.length) return norm;
  parts[parts.length - 1] = singularize(parts[parts.length - 1]);
  return parts.join(' ');
}


/**
 * Rebuild exact-match alignments across graphs by norm_label.
 * Produces canonical ordered pairs (a_source < b_source) to avoid duplicates.
 * method='exact', confidence=1.0
 */
export function runExactAlignments() {
  const db = getDB();
  const concepts = db.prepare(`
    SELECT id, norm_label, source_graph
    FROM concepts
    WHERE source_graph IN ('domain','syllabus','personal')
  `).all();

  // index by both norm and singular-norm
  const byKey = new Map(); // key -> { domain:[], syllabus:[], personal:[] }
  function push(key, row) {
    if (!byKey.has(key)) byKey.set(key, { domain: [], syllabus: [], personal: [] });
    byKey.get(key)[row.source_graph].push(row.id);
  }

  for (const c of concepts) {
    if (!c.norm_label) continue;
    push(c.norm_label, c);
    push(singularNorm(c.norm_label), c);
  }

  const order = ['domain','personal','syllabus'];
  const pairs = [];
  for (const buckets of byKey.values()) {
    const present = order.filter(s => (buckets[s] && buckets[s].length));
    if (present.length < 2) continue;
    for (let i = 0; i < present.length; i++) {
      for (let j = i+1; j < present.length; j++) {
        const sa = present[i], sb = present[j];
        for (const a_id of buckets[sa]) for (const b_id of buckets[sb]) {
          pairs.push({ a_id, b_id, a_source: sa, b_source: sb });
        }
      }
    }
  }

  db.exec('BEGIN;');
  try {
    db.prepare(`DELETE FROM alignments WHERE method = 'exact'`).run();
    const ins = db.prepare(`
      INSERT OR IGNORE INTO alignments
        (a_id, b_id, a_source, b_source, method, confidence, notes)
      VALUES (?, ?, ?, ?, 'exact', 1.0, NULL)
    `);
    for (const p of pairs) ins.run(p.a_id, p.b_id, p.a_source, p.b_source);
    db.exec('COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK;');
    throw e;
  }
}

/** Count overlaps via exact alignments */
export function countOverlaps() {
  const db = getDB();

  // Load distinct norm labels per graph
  const rows = db.prepare(`
    SELECT DISTINCT norm_label, source_graph
    FROM concepts
    WHERE source_graph IN ('domain','syllabus','personal')
  `).all();

  const sets = { domain: new Set(), syllabus: new Set(), personal: new Set() };
  for (const r of rows) {
    if (!r.norm_label) continue;
    sets[r.source_graph].add(r.norm_label);
    // also add singular variant
    sets[r.source_graph].add(singularNorm(r.norm_label));
  }

  // count intersections via JS sets (fast enough for our sizes)
  const countIntersect = (A, B) => {
    let n = 0;
    for (const x of A) if (B.has(x)) n++;
    return n;
  };

  return {
    dg_sg: countIntersect(sets.domain, sets.syllabus),
    dg_pg: countIntersect(sets.domain, sets.personal),
    // canonical order used in UI isn’t important here — just report the size
    sg_pg: countIntersect(sets.syllabus, sets.personal),
  };
}

export function countOverlapsAligned() {
  const db = getDB();
  const rows = db.prepare(`
    SELECT a_source, b_source, COUNT(*) AS n
    FROM alignments
    WHERE method IN ('exact','embedding','llm')
    GROUP BY a_source, b_source
  `).all();
  const get = (x,y) => rows.find(r => r.a_source===x && r.b_source===y)?.n || 0;
  return {
    dg_sg: get('domain','syllabus'),
    dg_pg: get('domain','personal'),
    sg_pg: get('personal','syllabus')
  };
}
