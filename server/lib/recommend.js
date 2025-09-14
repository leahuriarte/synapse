import { getDB } from './db.js';

function daysUntil(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const d = (t - Date.now()) / (1000*60*60*24);
  return Math.ceil(d);
}

/**
 * Recommend up to `limit` from (DG ∩ SG) \ PG.
 * Scoring:
 *  +1 if assessed (assignment/outcome)
 *  +min(1, (7 - daysUntil)/7) if due within 7 days
 *  +percent prereqs satisfied
 *  +0.05*out-degree (centrality)
 */
export function nextUp(limit = 5) {
  const db = getDB();

  const prereqRows = db.prepare(`
    SELECT e.dst_concept_id AS dst, e.src_concept_id AS src
    FROM edges e WHERE e.source_graph='domain' AND e.relation='prereq'
  `).all();
  const prereqMap = new Map();
  for (const r of prereqRows) {
    if (!prereqMap.has(r.dst)) prereqMap.set(r.dst, []);
    prereqMap.get(r.dst).push(r.src);
  }

  const dgsg = db.prepare(`
    SELECT a_id AS dg_id, b_id AS sg_id FROM alignments
    WHERE a_source='domain' AND b_source='syllabus' AND method IN ('exact','embedding','llm')
    UNION
    SELECT b_id AS dg_id, a_id AS sg_id FROM alignments
    WHERE a_source='syllabus' AND b_source='domain' AND method IN ('exact','embedding','llm')
  `).all();

  const dgp = db.prepare(`
    SELECT DISTINCT (CASE WHEN a_source='domain' THEN a_id ELSE b_id END) AS dg_id
    FROM alignments
    WHERE (a_source='domain' AND b_source='personal')
       OR (a_source='personal' AND b_source='domain')
  `).all().map(r => r.dg_id);
  const pgKnown = new Set(dgp);

  const candidatesDG = new Set(dgsg.map(x => x.dg_id).filter(id => !pgKnown.has(id)));
  if (candidatesDG.size === 0) return [];

  const concepts = new Map(db.prepare(`SELECT id, label, provenance, source_graph FROM concepts`).all()
    .map(r => [r.id, r]));
  const outdeg = new Map(
    db.prepare(`SELECT src_concept_id AS s, COUNT(*) n FROM edges WHERE source_graph='domain' GROUP BY src_concept_id`).all()
      .map(r => [r.s, r.n])
  );

  // map DG->SG
  const dg2sg = new Map();
  for (const p of dgsg) if (!dg2sg.has(p.dg_id)) dg2sg.set(p.dg_id, p.sg_id);

  const scored = [];
  for (const dgId of candidatesDG) {
    const reqs = prereqMap.get(dgId) || [];
    const known = reqs.filter(r => pgKnown.has(r));
    const frac = reqs.length ? known.length/reqs.length : 1;

    const sgId = dg2sg.get(dgId);
    const sg = concepts.get(sgId) || {};
    const prov = sg.provenance ? safeJson(sg.provenance) : null;
    const assessed = prov && (prov.type === 'assignment' || prov.type === 'outcome') ? 1 : 0;

    let dueBoost = 0;
    const days = prov?.due_at ? daysUntil(prov.due_at) : null;
    if (days !== null && days >= 0 && days <= 7) {
      dueBoost = Math.min(1, (7 - days) / 7); // closer = bigger boost (0..1)
    }

    const central = (outdeg.get(dgId) || 0) * 0.05;
    const score = 1 + assessed + dueBoost + frac + central;

    scored.push({
      dgId,
      label: concepts.get(dgId)?.label || `Concept ${dgId}`,
      frac, assessed: !!assessed, due_in_days: days,
      link: prov?.html_url || prov?.url || null,
      missing: reqs.filter(r => !pgKnown.has(r)).map(id => concepts.get(id)?.label || `Concept ${id}`),
      whyBits: { assessed: !!assessed, due: days }
    });
  }

  // prefer fully ready; then best partials
  const ready = scored.filter(x => x.frac === 1).sort((a,b)=>b.score-a.score);
  const partials = scored.filter(x => x.frac < 1).sort((a,b)=>b.score-a.score);
  const picks = (ready.length ? ready : partials).slice(0, limit);

  return picks.map(x => ({
    label: x.label,
    why: x.frac === 1
      ? x.whyBits.assessed
          ? 'Assessed; all prerequisites satisfied'
          : 'All prerequisites satisfied; appears in syllabus'
      : `Almost ready (${Math.round(x.frac*100)}% prereqs met)` + (x.whyBits.assessed ? '; assessed' : ''),
    missing_prereqs: x.frac === 1 ? [] : x.missing,
    due_in_days: x.due_in_days,
    link: x.link || null
  }));
}

function safeJson(s){ try { return JSON.parse(s); } catch { return null; } }
