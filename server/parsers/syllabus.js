import { parse } from 'node-html-parser';

export function extractSyllabusConcepts(html) {
  if (!html) return [];
  let concepts = [];
  try {
    const root = parse(html);
    // Pull headings and list items as candidate “topics”
    root.querySelectorAll('h1,h2,h3,h4,h5,h6,li').forEach(node => {
      const text = node.text?.trim().replace(/\s+/g, ' ');
      if (text && text.length > 2) concepts.push(text);
    });
    // Dedup
    concepts = Array.from(new Set(concepts));
  } catch {
    // ignore parse errors, return empty
  }
  return concepts.slice(0, 200);
}
