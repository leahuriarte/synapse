// Very lightweight Mermaid parser for "graph TD" style definitions.
// Extracts nodes like A["Label"] and edges A --> B, A --- B, A -->|part_of| B.

const NODE_RE = /(^|\s)([A-Za-z0-9_]+)\s*\[\s*"?([^"\]]+)"?\s*\]/g;
const EDGE_RE = /(^|\s)([A-Za-z0-9_]+)\s*-->\s*(?:\|\s*([^|]+?)\s*\|\s*)?([A-Za-z0-9_]+)/g;
const EDGE_REL_RELATED = /(^|\s)([A-Za-z0-9_]+)\s*---\s*([A-Za-z0-9_]+)/g;

export function stripEmoji(s) {
  // remove emojis & pictographs
  return String(s).replace(/\p{Extended_Pictographic}/gu, '');
}

export function normalizeLabel(s) {
  // lower, strip emoji, remove accents, keep a-z0-9 and spaces
  const noEmoji = stripEmoji(String(s));
  const folded = noEmoji.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return folded.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseMermaid(mermaidText) {
  const nodes = new Map(); // id -> { id, label }
  const edges = [];        // { srcId, dstId, relation }

  // nodes
  let m;
  while ((m = NODE_RE.exec(mermaidText)) !== null) {
    const id = m[2];
    const label = m[3].trim();
    if (!nodes.has(id)) nodes.set(id, { id, label });
  }

  // edges: --> with optional |label|
  while ((m = EDGE_RE.exec(mermaidText)) !== null) {
    const srcId = m[2], label = (m[3] || '').trim().toLowerCase(), dstId = m[4];
    let relation = 'prereq';
    if (label === 'part_of' || label === 'part of') relation = 'part_of';
    edges.push({ srcId, dstId, relation });
  }

  // edges: --- (relates_to)
  while ((m = EDGE_REL_RELATED.exec(mermaidText)) !== null) {
    const srcId = m[2], dstId = m[3];
    edges.push({ srcId, dstId, relation: 'relates_to' });
  }

  return { nodes: Array.from(nodes.values()), edges };
}
