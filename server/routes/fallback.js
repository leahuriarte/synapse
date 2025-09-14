import { Router } from 'express';
import { ingestSyllabusMermaid } from '../lib/graph_store.js';
import { buildSyllabusMermaid } from '../lib/sg_builder.js';
import { runExactAlignments } from '../lib/align.js';
import { extractSyllabusConcepts } from '../parsers/syllabus.js';

const router = Router();

/** helpers */
function isoDateAt(hour=23, minute=59, second=0, ms=0, d=new Date()) {
  const x = new Date(d);
  x.setHours(hour, minute, second, ms);
  return x.toISOString();
}
function nextMonday(d=new Date()) {
  const x = new Date(d);
  const day = x.getDay(); // 0=Sun..6=Sat
  const diff = (8 - day) % 7 || 7; // at least next Monday
  x.setDate(x.getDate() + diff);
  x.setHours(0,0,0,0);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * POST /ingest/fallback/syllabus/discrete
 * Body (optional): { startDate?: "YYYY-MM-DD" }  -> week 1 starts Monday of that week
 */
router.post('/ingest/fallback/syllabus/discrete', async (req, res) => {
  try {
    const start = (() => {
      const s = (req.body?.startDate || '').trim();
      if (!s) return nextMonday();
      const dt = new Date(s);
      if (Number.isNaN(dt.getTime())) return nextMonday();
      // align to Monday of that week
      const Monday = new Date(dt);
      const day = Monday.getDay();
      const back = (day + 6) % 7; // days since Monday
      Monday.setDate(Monday.getDate() - back);
      Monday.setHours(0,0,0,0);
      return Monday;
    })();

    /** Week plan (12 weeks) */
    const weeks = [
      { title: 'Logic & Propositional Calculus', topics: ['Propositions', 'Truth Tables', 'Logical Equivalence', 'Implication & Contrapositive'] },
      { title: 'Predicate Logic & Quantifiers', topics: ['Predicates', '∀ / ∃ Quantifiers', 'Negation of Quantifiers'] },
      { title: 'Proof Techniques I', topics: ['Direct Proof', 'Proof by Contradiction', 'Proof by Cases'] },
      { title: 'Proof Techniques II', topics: ['Mathematical Induction', 'Strong Induction', 'Well-Ordering'] },
      { title: 'Sets & Operations', topics: ['Set Identities', 'Power Set', 'Cartesian Product'] },
      { title: 'Functions & Relations', topics: ['Injective/Surjective/Bijective', 'Inverses & Compositions', 'Equivalence Relations', 'Partitions'] },
      { title: 'Number Theory', topics: ['Divisibility', 'GCD & Euclid', 'Modular Arithmetic', 'Congruences'] },
      { title: 'Recurrences & Growth', topics: ['Solving Linear Recurrences', 'Master Theorem (intuition)', 'Asymptotic Notation'] },
      { title: 'Counting I', topics: ['Sum & Product Rules', 'Permutations & Combinations', 'Binomial Theorem'] },
      { title: 'Counting II & Probability', topics: ['Pigeonhole Principle', 'Inclusion–Exclusion', 'Discrete Probability'] },
      { title: 'Graphs', topics: ['Graph Models', 'Degree, Paths, Cycles', 'Connectivity', 'Bipartite Graphs'] },
      { title: 'Trees & Applications', topics: ['Trees & Spanning Trees', 'Tree Traversals', 'Minimal Spanning Trees (intuition)'] },
    ];

    // Build Canvas-like objects (course, modules, items, assignments, pages)
    const course = { id: 99901, name: 'Fallback: Discrete Mathematics' };
    const modules = weeks.map((w, i) => ({ id: 9100 + i, name: `Week ${i+1}: ${w.title}` }));

    // Assignments: one HW per week, due Friday 23:59 of that week
    const assignments = weeks.map((w, i) => {
      const weekStart = addDays(start, i*7);
      const dueFri = addDays(weekStart, 4); // Friday
      return {
        id: 9200 + i,
        name: `Homework ${i+1}: ${w.title}`,
        html_url: `https://example.invalid/fallback/assignments/hw-${i+1}`,
        due_at: isoDateAt(23,59,0,0,dueFri),
        description: `<h3>${w.title} – Homework ${i+1}</h3><ul>${
          w.topics.map(t => `<li>${t}</li>`).join('')
        }</ul>`
      };
    });

    // For each module: a Page (lecture notes) + the Assignment item
    const pages = weeks.map((w, i) => {
      const url = `week-${i+1}-notes`;
      return {
        url, title: `Week ${i+1} Notes: ${w.title}`,
        html_url: `https://example.invalid/fallback/pages/${url}`,
        body: `<h2>${w.title}</h2>
               <h3>Key Ideas</h3>
               <ul>${w.topics.map(t=>`<li>${t}</li>`).join('')}</ul>
               <h3>Examples</h3>
               <ul>${w.topics.slice(0,2).map(t=>`<li>${t} example</li>`).join('')}</ul>`
      };
    });

    // module items map: Page + Assignment references
    const moduleItemsMap = new Map(
      modules.map((m, i) => {
        const items = [
          { id: 93000 + i*10 + 1, type: 'Page', title: pages[i].title, html_url: pages[i].html_url, page_url: pages[i].url },
          { id: 93000 + i*10 + 2, type: 'Assignment', title: assignments[i].name, html_url: assignments[i].html_url, content_id: assignments[i].id },
        ];
        return [m.id, items];
      })
    );

    // page Topics via HTML headings
    const pageTopics = new Map(pages.map(p => [p.url, extractSyllabusConcepts(p.body).slice(0, 12)]));

    // assignment topics from their descriptions
    const assignmentTopics = new Map(assignments.map(a => [a.id, extractSyllabusConcepts(a.description).slice(0, 10)]));

    // Build Mermaid + meta and ingest
    const { mermaid, meta } = buildSyllabusMermaid({
      course,
      modules,
      moduleItemsMap,
      assignments,
      outcomes: [],
      files: [],
      fileTopics: new Map(),
      pages,
      pageTopics,
      assignmentTopics
    });

    ingestSyllabusMermaid(mermaid, meta);
    runExactAlignments(); // keep overlaps fresh

    res.json({
      ok: true,
      course: { id: course.id, name: course.name },
      counts: {
        modules: modules.length,
        assignments: assignments.length,
        outcomes: 0,
        files: 0,
        pages: pages.length
      }
    });
  } catch (e) {
    console.error('[fallback/discrete] failed', e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
