import { extractSyllabusConcepts } from '../parsers/syllabus.js';

const esc = s => String(s).replace(/"/g, '\\"');
const itemLabel = it => it.title || `${it.type || 'Item'} ${it.id}`;

export function buildSyllabusMermaid({
  course, modules, moduleItemsMap, assignments, outcomes,
  files, fileTopics,
  pages, pageTopics,
  assignmentTopics
}) {
  const lines = ['graph TD;'];
  const meta = [];

  if (course?.name) lines.push(`  C0["Course: ${esc(course.name)}"]`);
  lines.push(`  SYL["Syllabus"]`);
  lines.push(`  OUT["Outcomes"]`);
  lines.push(`  PAGES["Pages"]`);

  // syllabus headings
  const syl = extractSyllabusConcepts(course?.syllabus_body || '').slice(0, 50);
  syl.forEach((txt, i) => {
    const id = `S${i+1}`, label = txt;
    lines.push(`  ${id}["${esc(label)}"] -->|part_of| SYL`);
    meta.push({ label, provenance: { type:'syllabus', course_id: course?.id }});
  });

  // modules + items
  modules.forEach((m, idx) => {
    const mid = `M${idx+1}`, mLabel = `Module: ${m.name}`;
    lines.push(`  ${mid}["${esc(mLabel)}"]`);
    if (course?.name) lines.push(`  ${mid} -->|part_of| C0`);
    const items = moduleItemsMap.get(m.id) || [];
    items.forEach((it, j) => {
      const iid = `MI${idx+1}_${j+1}`, label = itemLabel(it);
      lines.push(`  ${iid}["${esc(label)}"] -->|part_of| ${mid}`);
      meta.push({ label, provenance: { type:'module_item', module_id:m.id, id:it.id, html_url: it.html_url || null }});
      if (it.type === 'Assignment' && it.content_id) {
        const a = assignments.find(a => a.id === it.content_id);
        if (a) {
          const aid = `A${a.id}`, aLabel = `Assignment: ${a.name}`;
          lines.push(`  ${aid}["${esc(aLabel)}"] -->|part_of| ${mid}`);
          meta.push({ label: aLabel, provenance: { type:'assignment', id:a.id, html_url:a.html_url || null, due_at:a.due_at || null }});
        }
      }
      if (it.type === 'Page' && it.page_url) {
        // connect the Page node under this module when we render pages below
        meta.push({ label: `__PAGE_ANCHOR__${it.page_url}`, provenance: { type:'page_anchor', module_id:m.id }});
      }
    });
  });

  // assignments not already attached + topics from description
  assignments.forEach(a => {
    const aLabel = `Assignment: ${a.name}`;
    const has = lines.some(l => l.includes(`["${esc(aLabel)}"]`));
    if (!has) {
      lines.push(`  A${a.id}["${esc(aLabel)}"] -->|part_of| C0`);
      meta.push({ label: aLabel, provenance: { type:'assignment', id:a.id, html_url:a.html_url || null, due_at:a.due_at || null }});
    }
    const topics = (assignmentTopics.get(a.id) || []).slice(0, 8);
    topics.forEach((t, i) => {
      const nid = `AT${a.id}_${i+1}`;
      const label = t;
      lines.push(`  ${nid}["${esc(label)}"] -->|part_of| A${a.id}`);
      meta.push({ label, provenance: { type:'assignment_desc', id:a.id }});
    });
  });

  // outcomes
  (outcomes || []).forEach((o, i) => {
    const label = `Outcome: ${o.display_name || o.title || o.short_description || `Outcome ${i+1}`}`;
    lines.push(`  O${o.id || i+1}["${esc(label)}"] -->|part_of| OUT`);
    meta.push({ label, provenance: { type:'outcome', id:o.id || null }});
  });

  // files (if any) + topics
  (files || []).forEach((f, i) => {
    const fLabel = `File: ${f.display_name || f.filename || `File ${i+1}`}`;
    const fid = `F${f.id || (1000+i)}`;
    lines.push(`  ${fid}["${esc(fLabel)}"] -->|part_of| C0`);
    meta.push({ label: fLabel, provenance: { type:'file', id:f.id, html_url:f.html_url || null, url:f.url || null }});
    const topics = fileTopics.get(f.id) || [];
    topics.slice(0, 200).forEach((tp, k) => {
      const label = `${tp.lines[0]}`;
      const nid = `FP${f.id}_${tp.page}_${k+1}`;
      lines.push(`  ${nid}["${esc(label)}"] -->|part_of| ${fid}`);
      meta.push({ label, provenance: { type:'file_page', file_id:f.id, page:tp.page }});
    });
  });

  // pages + headings (prefer to sit under their module if referenced there)
  const pageUrlToModule = new Map();
  meta.filter(m => m.label?.startsWith('__PAGE_ANCHOR__')).forEach(m => {
    const url = m.label.replace('__PAGE_ANCHOR__','');
    pageUrlToModule.set(url, m.provenance.module_id);
  });

  (pages || []).forEach((p, i) => {
    const pid = `PG${i+1}`;
    const pLabel = `Page: ${p.title || p.url || `Page ${i+1}`}`;
    const moduleId = pageUrlToModule.get(p.url);
    const parent = moduleId ? `M${modules.findIndex(m => m.id === moduleId)+1}` : 'PAGES';
    lines.push(`  ${pid}["${esc(pLabel)}"] -->|part_of| ${parent}`);
    meta.push({ label: pLabel, provenance: { type:'page', url: p.url, html_url: p.html_url || null }});
    const topics = pageTopics.get(p.url) || [];
    topics.slice(0, 40).forEach((txt, k) => {
      const nid = `PGT${i+1}_${k+1}`;
      lines.push(`  ${nid}["${esc(txt)}"] -->|part_of| ${pid}`);
      meta.push({ label: txt, provenance: { type:'page_heading', url: p.url }});
    });
  });

  return { mermaid: lines.join('\n'), meta };
}
