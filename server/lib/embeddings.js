import { getDB } from './db.js';
import { embedBatch } from './gemini.js';

const THRESH = Number(process.env.EMBED_SIM_THRESHOLD ?? 0.82);
const TOPK = Number(process.env.EMBED_TOPK ?? 3);

function dot(a,b){let s=0;for(let i=0;i<a.length;i++) s+=a[i]*b[i]; return s;}
function norm(a){return Math.sqrt(dot(a,a)) || 1;}
function cosine(a,b){return dot(a,b)/(norm(a)*norm(b));}

function fetchConceptsBySource(source) {
  const db = getDB();
  return db.prepare(`
    SELECT id, label, norm_label, source_graph FROM concepts
    WHERE source_graph = ?
  `).all(source);
}

function upsertEmbeddingRows(rows, dim, modelId){
  const db = getDB();
  const ins = db.prepare(`
    INSERT INTO embeddings (concept_id, model, dim, vector)
    VALUES (@concept_id, @model, @dim, @vector)
    ON CONFLICT(concept_id) DO UPDATE SET
      model=excluded.model, dim=excluded.dim, vector=excluded.vector,
      updated_at=datetime('now')
  `);
  db.exec('BEGIN;');
  try{
    for(const r of rows) ins.run({
      concept_id: r.id,
      model: modelId,
      dim,
      vector: JSON.stringify(r.vec)
    });
    db.exec('COMMIT;');
  }catch(e){ db.exec('ROLLBACK;'); throw e; }
}

function loadEmbeddingsByIds(ids){
  const db = getDB();
  if (!ids.length) return new Map();
  const placeholders = ids.map(()=>'?').join(',');
  const rows = db.prepare(`
    SELECT concept_id, dim, vector FROM embeddings
    WHERE concept_id IN (${placeholders})
  `).all(...ids);
  const map = new Map();
  for(const r of rows) map.set(r.concept_id, JSON.parse(r.vector));
  return map;
}

export async function ensureEmbeddingsForSources(sources=['domain','syllabus','personal']){
  const db = getDB();
  const rows = db.prepare(`
    SELECT c.id, c.label, c.source_graph, e.concept_id AS has_embed
    FROM concepts c
    LEFT JOIN embeddings e ON e.concept_id = c.id
    WHERE c.source_graph IN (${sources.map(()=>'?').join(',')})
  `).all(...sources);

  const need = rows.filter(r => !r.has_embed);
  if (!need.length) return;

  // batch by 100 for safety
  for (let i=0; i<need.length; i+=100){
    const chunk = need.slice(i, i+100);
    const texts = chunk.map(r => r.label);
    const { vectors, dim, modelId } = await embedBatch(texts);
    const toStore = chunk.map((r, idx) => ({ ...r, vec: vectors[idx] }));
    upsertEmbeddingRows(toStore, dim, modelId);
  }
}

function nearestPairs(A, B) {
  // Build simple arrays for speed
  const aEmb = loadEmbeddingsByIds(A.map(a=>a.id));
  const bEmb = loadEmbeddingsByIds(B.map(b=>b.id));

  // brute-force with TOPK limit per A (datasets are small enough)
  const pairs = [];
  for (const a of A){
    const va = aEmb.get(a.id);
    if (!va) continue;
    const sims = [];
    for (const b of B){
      const vb = bEmb.get(b.id);
      if (!vb) continue;
      sims.push({ a_id:a.id, b_id:b.id, a_source:a.source_graph, b_source:b.source_graph, sim: cosine(va,vb) });
    }
    sims.sort((x,y)=>y.sim-x.sim);
    for (let k=0;k<Math.min(TOPK, sims.length);k++){
      if (sims[k].sim >= THRESH) pairs.push(sims[k]);
    }
  }
  return pairs;
}

export async function runEmbeddingAlignments() {
  await ensureEmbeddingsForSources(['domain','syllabus','personal']);

  // load concepts (we’ll skip those that already exact-align on identical norm_label)
  const db = getDB();
  const DG = fetchConceptsBySource('domain');
  const SG = fetchConceptsBySource('syllabus');
  const PG = fetchConceptsBySource('personal');

  // remove trivially-equal labels to save compute
  const hasLabel = (arr, norm) => arr.some(x => x.norm_label === norm);
  const dFiltered = DG; // keep all domain
  const sFiltered = SG.filter(s => !hasLabel(DG, s.norm_label));
  const pFiltered = PG.filter(p => !hasLabel(DG, p.norm_label) && !hasLabel(SG, p.norm_label));

  const dsPairs = nearestPairs(dFiltered, sFiltered);
  const dpPairs = nearestPairs(dFiltered, pFiltered);
  const spPairs = nearestPairs(sFiltered, pFiltered);

  // write to alignments (method='embedding')
  const ins = db.prepare(`
    INSERT OR IGNORE INTO alignments
      (a_id, b_id, a_source, b_source, method, confidence, notes)
    VALUES (?, ?, ?, ?, 'embedding', ?, NULL)
  `);

  db.exec('BEGIN;');
  try{
    for(const p of [...dsPairs, ...dpPairs, ...spPairs]){
      ins.run(p.a_id, p.b_id, p.a_source, p.b_source, p.sim);
    }
    db.exec('COMMIT;');
  }catch(e){ db.exec('ROLLBACK;'); throw e; }

  return { counts: { ds: dsPairs.length, dp: dpPairs.length, sp: spPairs.length } };
}
