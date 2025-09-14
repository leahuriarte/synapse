// server/parsers/parse_pdf.js
// NOTE: Avoid pdf-parse's index.js (it tries to open a test file).
// We lazy-import the internal parser module instead.

async function parsePdfBuffer(buf) {
  // Import the actual parser implementation, not the package root.
  // Works with pdf-parse v1.x.
  const { default: pdf } = await import('pdf-parse/lib/pdf-parse.js');
  return pdf(buf);
}

/**
 * Heuristic PDF "topics": take the first 1–3 non-trivial lines per page.
 * Returns [{page, lines:[...]}]
 */
export async function extractPdfTopics(buf) {
  const data = await parsePdfBuffer(buf);

  // Some versions return a single big string with \f as page breaks.
  const pages = (data.text || '').split(/\f/g);
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    const raw = pages[i] || '';
    const lines = raw
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(s => s && s.length > 2 && s.length < 120)
      .slice(0, 3);
    if (lines.length) out.push({ page: i + 1, lines });
  }
  return out;
}
