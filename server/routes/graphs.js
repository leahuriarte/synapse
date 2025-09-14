import { Router } from 'express';
import { getLatestSnapshotsAll, countNodesFromMermaid } from '../lib/dao.js';
import { countOverlaps } from '../lib/align.js';
import { countOverlapsAligned } from '../lib/align.js';
import { nextUp } from '../lib/recommend.js';

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
    recommendations: nextUp(5)
  });
});

export default router;


