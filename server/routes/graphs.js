import { Router } from 'express';
import { getLatestSnapshotsAll, countNodesFromMermaid } from '../lib/dao.js';
import { countOverlaps } from '../lib/align.js';
import { countOverlapsAligned } from '../lib/align.js';
import { nextUp } from '../lib/recommend.js';
import { getDB } from '../lib/db.js';

const router = Router();

function countAssessedFromSG(mermaidText) {
  if (!mermaidText) return 0;
  // Heuristic: count nodes whose labels start with "Assignment:" or "Outcome:"
  // by scanning Mermaid label blocks.
  const matches = mermaidText.match(/\["([^"]+)"\]/g) || [];
  let n = 0;
  for (const m of matches) {
    const label = m.slice(2, -2); // strip [" and "]
    const head = label.split(':')[0].trim().toLowerCase();
    if (head === 'assignment' || head === 'outcome') n++;
  }
  return n;
}

function getCrossGraphMastery() {
  const db = getDB();

  try {
    // Optimized single query with indexes - no caching
    const alignedMastery = db.prepare(`
      SELECT
        domain_c.norm_label as norm_label,
        domain_c.source_graph as source_graph,
        p.mastery as mastery
      FROM alignments a
      JOIN concepts personal_c ON personal_c.id = a.b_id AND personal_c.source_graph = 'personal'
      JOIN concepts domain_c ON domain_c.id = a.a_id AND domain_c.source_graph IN ('domain', 'syllabus')
      JOIN progress p ON p.concept_id = personal_c.id AND p.mastery IN ('learning', 'known')
      WHERE a.method = 'exact' AND a.confidence >= 0.8

      UNION

      SELECT
        domain_c.norm_label as norm_label,
        domain_c.source_graph as source_graph,
        p.mastery as mastery
      FROM alignments a
      JOIN concepts personal_c ON personal_c.id = a.a_id AND personal_c.source_graph = 'personal'
      JOIN concepts domain_c ON domain_c.id = a.b_id AND domain_c.source_graph IN ('domain', 'syllabus')
      JOIN progress p ON p.concept_id = personal_c.id AND p.mastery IN ('learning', 'known')
      WHERE a.method = 'exact' AND a.confidence >= 0.8
    `).all();

    const result = { domain: {}, syllabus: {} };

    // Group by source_graph for fast lookup
    alignedMastery.forEach(row => {
      result[row.source_graph][row.norm_label] = row.mastery;
    });

    return result;
  } catch (error) {
    console.warn('getCrossGraphMastery error:', error);
    return { domain: {}, syllabus: {} };
  }
}

router.get('/graphs', (req, res) => {
  res.set('Cache-Control', 'no-store');  
  const mermaid = getLatestSnapshotsAll();

  const fallback = (g, label) =>
    mermaid[g] ||
    `graph TD;\n  X["Run: npm run db:seed or build ${label}"] --> Y["…"];`;

  const dg = fallback('dg', 'Domain Graph');
  const sg = fallback('sg', 'Syllabus Graph');
  const pg = fallback('pg', 'Personal Graph');

  const overlaps_raw = countOverlaps();              // set-intersection (norm/singular)
  const overlaps_aligned = countOverlapsAligned();
  const crossGraphMastery = getCrossGraphMastery();

  res.json({
    mermaid: { dg, sg, pg },
    counts: {
      dg_nodes: countNodesFromMermaid(dg),
      sg_nodes: countNodesFromMermaid(sg),
      pg_nodes: countNodesFromMermaid(pg),
      overlaps: overlaps_aligned,      // show aligned by default in header
      overlaps_raw,                    // still available if you want to compare
      assessed_sg: countAssessedFromSG(sg)
    },
    mastery: crossGraphMastery,         // Cross-graph mastery synchronization data
    recommendations: nextUp(5)
  });
});

export default router;


