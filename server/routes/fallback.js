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

    /** Concept-focused curriculum with interconnected topics */
    const conceptGroups = [
      {
        name: 'Foundational Logic',
        concepts: ['Propositions', 'Truth Tables', 'Logical Equivalence', 'Implication & Contrapositive', 'Predicates', '∀ / ∃ Quantifiers', 'Negation of Quantifiers'],
        prerequisites: [],
        leads_to: ['proof_techniques', 'set_theory']
      },
      {
        name: 'Proof Techniques',
        concepts: ['Direct Proof', 'Proof by Contradiction', 'Proof by Cases', 'Mathematical Induction', 'Strong Induction', 'Well-Ordering'],
        prerequisites: ['foundational_logic'],
        leads_to: ['number_theory', 'set_theory', 'combinatorics']
      },
      {
        name: 'Set Theory',
        concepts: ['Set Identities', 'Power Set', 'Cartesian Product', 'Set Operations', 'Venn Diagrams'],
        prerequisites: ['foundational_logic'],
        leads_to: ['functions_relations', 'combinatorics']
      },
      {
        name: 'Functions & Relations',
        concepts: ['Injective/Surjective/Bijective', 'Inverses & Compositions', 'Equivalence Relations', 'Partitions', 'Function Types'],
        prerequisites: ['set_theory'],
        leads_to: ['graph_theory', 'combinatorics']
      },
      {
        name: 'Number Theory',
        concepts: ['Divisibility', 'GCD & Euclid', 'Modular Arithmetic', 'Congruences', 'Prime Numbers'],
        prerequisites: ['proof_techniques'],
        leads_to: ['cryptography_applications']
      },
      {
        name: 'Combinatorics',
        concepts: ['Sum & Product Rules', 'Permutations & Combinations', 'Binomial Theorem', 'Pigeonhole Principle', 'Inclusion–Exclusion'],
        prerequisites: ['proof_techniques', 'set_theory'],
        leads_to: ['discrete_probability', 'graph_theory']
      },
      {
        name: 'Graph Theory',
        concepts: ['Graph Models', 'Degree, Paths, Cycles', 'Connectivity', 'Bipartite Graphs', 'Trees & Spanning Trees', 'Tree Traversals'],
        prerequisites: ['functions_relations', 'combinatorics'],
        leads_to: ['algorithms', 'network_applications']
      },
      {
        name: 'Discrete Probability',
        concepts: ['Sample Spaces', 'Events', 'Conditional Probability', 'Independence', 'Random Variables'],
        prerequisites: ['combinatorics'],
        leads_to: ['statistics_applications']
      },
      {
        name: 'Recurrence Relations',
        concepts: ['Solving Linear Recurrences', 'Generating Functions', 'Master Theorem', 'Asymptotic Notation'],
        prerequisites: ['proof_techniques'],
        leads_to: ['algorithms', 'complexity_analysis']
      }
    ];

    // Build Canvas-like objects (course, modules, items, assignments, pages) based on concept groups
    const course = { id: 99901, name: 'Fallback: Discrete Mathematics (Concept-Focused)' };
    const modules = conceptGroups.map((group, i) => ({
      id: 9100 + i,
      name: group.name,
      description: `Core concepts: ${group.concepts.slice(0,3).join(', ')}${group.concepts.length > 3 ? '...' : ''}`
    }));

    // Assignments: concept-based rather than weekly
    const assignments = conceptGroups.map((group, i) => {
      // Stagger due dates based on prerequisites (foundational concepts due earlier)
      const daysOffset = group.prerequisites.length === 0 ? 14 : 30 + (group.prerequisites.length * 7);
      const dueDate = addDays(start, daysOffset);

      return {
        id: 9200 + i,
        name: `${group.name} Assessment`,
        html_url: `https://example.invalid/fallback/assignments/concept-${i+1}`,
        due_at: isoDateAt(23,59,0,0,dueDate),
        description: `<h3>${group.name} – Conceptual Assessment</h3>
                     <h4>Core Concepts:</h4>
                     <ul>${group.concepts.map(t => `<li>${t}</li>`).join('')}</ul>
                     ${group.prerequisites.length > 0 ?
                       `<h4>Prerequisites:</h4><ul>${group.prerequisites.map(p => `<li>${p.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</li>`).join('')}</ul>` : ''}
                     <h4>Learning Path:</h4>
                     <p>This concept group builds towards: ${group.leads_to.map(lt => lt.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())).join(', ')}</p>`
      };
    });

    // Concept-focused pages with interconnections
    const pages = conceptGroups.map((group, i) => {
      const url = `concept-${group.name.toLowerCase().replace(/\s+/g, '-')}`;
      return {
        url,
        title: `${group.name} - Core Concepts`,
        html_url: `https://example.invalid/fallback/pages/${url}`,
        body: `<h2>${group.name}</h2>
               <h3>Key Concepts</h3>
               <ul>${group.concepts.map(concept => `<li><strong>${concept}</strong></li>`).join('')}</ul>

               ${group.prerequisites.length > 0 ? `
               <h3>Prerequisites</h3>
               <p>Before studying this topic, you should understand:</p>
               <ul>${group.prerequisites.map(prereq => `<li>${prereq.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</li>`).join('')}</ul>
               ` : '<h3>Foundation Topic</h3><p>This is a foundational concept that requires no prerequisites.</p>'}

               <h3>Applications & Connections</h3>
               <p>This concept group connects to and enables learning in:</p>
               <ul>${group.leads_to.map(connection => `<li>${connection.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</li>`).join('')}</ul>

               <h3>Learning Strategy</h3>
               <p>Focus on understanding the relationships between ${group.concepts.slice(0,2).join(' and ')}, then build towards practical applications.</p>`
      };
    });

    // module items map: Page + Assignment references based on concept groups
    const moduleItemsMap = new Map(
      modules.map((m, i) => {
        const items = [
          { id: 93000 + i*10 + 1, type: 'Page', title: pages[i].title, html_url: pages[i].html_url, page_url: pages[i].url },
          { id: 93000 + i*10 + 2, type: 'Assignment', title: assignments[i].name, html_url: assignments[i].html_url, content_id: assignments[i].id },
        ];
        return [m.id, items];
      })
    );

    // page Topics directly from concept groups (more accurate than extraction)
    const pageTopics = new Map(pages.map((p, i) => [p.url, conceptGroups[i].concepts]));

    // assignment topics directly from concept groups
    const assignmentTopics = new Map(assignments.map((a, i) => [a.id, conceptGroups[i].concepts]));

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
