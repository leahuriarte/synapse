import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';

mermaid.initialize({ startOnLoad: false, theme: 'dark', maxTextSize: 100000 });

async function poll() {
  // health first (best-effort)
  try {
    const health = await fetch('/health', { cache: 'no-store' }).then(r => r.json());
    document.getElementById('status').textContent = health.ok ? 'online' : 'offline';
  } catch {
    document.getElementById('status').textContent = 'offline';
  }

  // graphs + counts
  let data;
  try {
    // prevent any caching weirdness
    data = await fetch(`/graphs?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json());
  } catch (e) {
    console.error('graphs fetch failed', e);
    return;
  }

  const { mermaid: mm, counts } = data || {};
  const c = counts || {};
  const ov = c.overlaps || { dg_sg: 0, sg_pg: 0, dg_pg: 0 };

  // 🔹 Update header counts immediately (even if Mermaid fails)
  document.getElementById('counts').textContent =
    `DG:${c.dg_nodes ?? 0}  SG:${c.sg_nodes ?? 0}  PG:${c.pg_nodes ?? 0} | ` +
    `Overlap DG∩SG:${ov.dg_sg}  SG∩PG:${ov.sg_pg}  DG∩PG:${ov.dg_pg}`;

  const list = document.getElementById('recs');
  if (list) {
    list.innerHTML = '';
    (data.recommendations || []).forEach(r => {
      const li = document.createElement('li');
      const a = document.createElement(r.link ? 'a' : 'span');
      a.textContent = r.label;
      if (r.link) {
        a.href = r.link;
        a.target = '_blank';
        a.rel = 'noopener';
        a.style.textDecoration = 'underline';
      }
      const due = (r.due_in_days !== null && r.due_in_days !== undefined)
        ? ` • due in ${r.due_in_days} day${r.due_in_days===1?'':'s'}`
        : '';
      const missing = (r.missing_prereqs && r.missing_prereqs.length)
        ? ` • missing: ${r.missing_prereqs.slice(0,3).join(', ')}${r.missing_prereqs.length>3?'…':''}`
        : '';
      const tail = document.createElement('span');
      tail.textContent = ` — ${r.why}${due}${missing}`;
      li.appendChild(a);
      li.appendChild(tail);
      list.appendChild(li);
    });
    if ((data.recommendations || []).length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No candidates yet. Try ingesting SG, building DG, and sending a chat turn.';
      list.appendChild(li);
    }
  }



  // update syllabus badge
  const assessed = c.assessed_sg ?? 0;
  const badge = document.getElementById('sg-badge');
  if (badge) badge.textContent = `Assessed: ${assessed}`;

  // inject Mermaid sources
  if (mm?.dg) document.getElementById('dg').textContent = mm.dg;
  if (mm?.sg) document.getElementById('sg').textContent = mm.sg;
  if (mm?.pg) document.getElementById('pg').textContent = mm.pg;

  // 🔹 Render Mermaid in a guarded try/catch so counts always stick
  try {
    await mermaid.run({
      nodes: ['#dg', '#sg', '#pg'].map(id => ({ id, selector: id }))
    });
  } catch (e) {
    // Don’t break the loop — just log and keep the latest counts visible
    console.warn('Mermaid render issue (harmless for counts):', e?.message || e);
  }
}

poll();
setInterval(poll, 3000);
