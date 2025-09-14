const BASE = process.env.CANVAS_BASE_URL?.replace(/\/+$/, '') || '';
const TOKEN = process.env.CANVAS_ACCESS_TOKEN || '';

function authHeaders() {
  if (!BASE || !TOKEN) {
    throw new Error('Canvas base URL or access token not configured (.env)');
  }
  return {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json'
  };
}

// Parse RFC5988 Link header for pagination
function parseLinkHeader(linkHeader) {
  if (!linkHeader) return {};
  const rels = {};
  linkHeader.split(',').forEach(part => {
    const m = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (m) rels[m[2]] = m[1];
  });
  return rels;
}

async function fetchAll(url) {
  const out = [];
  let next = url;
  while (next) {
    const r = await fetch(next, { headers: authHeaders() });
    if (!r.ok) throw new Error(`Canvas ${r.status} ${next}`);
    const data = await r.json();
    out.push(...data);
    const rels = parseLinkHeader(r.headers.get('Link'));
    next = rels.next || null;
  }
  return out;
}

export async function getCourseWithSyllabus(courseId) {
  const url = `${BASE}/api/v1/courses/${courseId}?include[]=syllabus_body`;
  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) throw new Error(`Canvas ${r.status} ${url}`);
  return r.json();
}

export async function getModules(courseId) {
  return fetchAll(`${BASE}/api/v1/courses/${courseId}/modules?per_page=100`);
}

export async function getModuleItems(courseId, moduleId) {
  return fetchAll(`${BASE}/api/v1/courses/${courseId}/modules/${moduleId}/items?per_page=100`);
}

export async function getAssignments(courseId) {
  return fetchAll(`${BASE}/api/v1/courses/${courseId}/assignments?per_page=100`);
}

// Outcomes are optional in many courses. If present, they’re under accounts/courses.
export async function getOutcomeGroups(courseId) {
  // Try course outcome groups first
  const url = `${BASE}/api/v1/courses/${courseId}/outcome_groups`;
  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) return [];
  return r.json();
}

export async function getOutcomesInGroup(groupId) {
  const url = `${BASE}/api/v1/outcome_groups/${groupId}/outcomes`;
  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) return { outcomes: [] };
  return r.json(); // {outcomes:[...]}
}

export async function getFiles(courseId) {
  return fetchAll(`${BASE}/api/v1/courses/${courseId}/files?per_page=100`);
}

export async function downloadFile(url) {
  // Canvas file "url" is a signed download URL; still send auth header just in case
  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) throw new Error(`Download ${r.status} ${url}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

export async function getFileById(fileId) {
  const url = `${BASE}/api/v1/files/${fileId}`;
  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) throw new Error(`Canvas ${r.status} ${url}`);
  return r.json();
}

export async function getPage(courseId, pageUrl) {
  const url = `${BASE}/api/v1/courses/${courseId}/pages/${encodeURIComponent(pageUrl)}`;
  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) throw new Error(`Canvas ${r.status} ${url}`);
  return r.json(); // { title, body, html_url, ... }
}
