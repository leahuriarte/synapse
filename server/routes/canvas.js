import { Router } from 'express';
import {
  getCourseWithSyllabus,
  getModules,
  getModuleItems,
  getAssignments,
  getOutcomeGroups,
  getOutcomesInGroup,
  getFileById,
  getPage,
  getFiles,
  downloadFile,
  getCourses
} from '../connectors/canvas.js';
import { buildSyllabusMermaid } from '../lib/sg_builder.js';
import { ingestSyllabusMermaid } from '../lib/graph_store.js';
import { extractPdfTopics } from '../parsers/parse_pdf.js';
import { runExactAlignments } from '../lib/align.js';

const router = Router();

router.post('/ingest/canvas/:courseId', async (req, res) => {
  const { courseId } = req.params;

  try {
    const [course, modules, assignments] = await Promise.all([
      getCourseWithSyllabus(courseId),
      getModules(courseId),
      getAssignments(courseId),
    ]);

    // module items
    const moduleItemsMap = new Map();
    await Promise.all(
      modules.map(async (m) => {
        const items = await getModuleItems(courseId, m.id);
        moduleItemsMap.set(m.id, items);
      })
    );

    // outcomes (best effort)
    let allOutcomes = [];
    try {
      const groups = await getOutcomeGroups(courseId);
      for (const g of groups || []) {
        const og = await getOutcomesInGroup(g.id);
        (og.outcomes || []).forEach(o => allOutcomes.push(o.outcome || o));
      }
    } catch {/* ignore */}

    // 4) files (prefer /courses/:id/files; if 403, fall back to module File items)
    let pdfFiles = [];
    let usedFallback = false;

    try {
      const allFiles = await getFiles(courseId); // may 403
      pdfFiles = allFiles.filter(f => (f['content-type'] || f.content_type || '').includes('pdf'));
    } catch (e) {
      if (String(e).includes('Canvas 403')) {
        usedFallback = true;
        // collect file IDs referenced in modules
        const fileIds = new Set();
        for (const items of moduleItemsMap.values()) {
          for (const it of items) {
            if (it.type === 'File' && it.content_id) fileIds.add(it.content_id);
          }
        }
        // resolve each file id to metadata and keep PDFs
        const metas = await Promise.all(
          [...fileIds].map(id => getFileById(id).catch(() => null))
        );
        pdfFiles = (metas.filter(Boolean) || []).filter(f =>
          (f['content-type'] || f.content_type || '').includes('pdf')
        );
      } else {
        throw e; // rethrow other errors
      }
    }

    // 5) parse PDFs into page-level topics (best-effort)
    const fileTopics = new Map();
    await Promise.all(
      pdfFiles.map(async (f) => {
        try {
          const buf = await downloadFile(f.url);
          const topics = await extractPdfTopics(buf);
          fileTopics.set(f.id, topics);
        } catch (err) {
          console.warn('pdf parse failed', f.display_name || f.filename, err.message);
        }
      })
    );

    // 6) build SG + meta and ingest
    const { mermaid, meta } = buildSyllabusMermaid({
      course, modules, moduleItemsMap, assignments, outcomes: allOutcomes,
      files: pdfFiles, fileTopics
    });
    ingestSyllabusMermaid(mermaid, meta);
    runExactAlignments();

    res.json({
      ok: true,
      course: { id: course.id, name: course.name },
      counts: {
        modules: modules.length,
        assignments: assignments.length,
        outcomes: allOutcomes.length,
        files: pdfFiles.length
      },
      notes: usedFallback ? 'Used modules→files fallback (files endpoint 403)' : undefined
    });
  } catch (e) {
    console.error('[ingest/canvas]', e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.get('/canvas/courses', async (req, res) => {
  try {
    const courses = await getCourses();
    res.json({
      ok: true,
      courses: courses.map(course => ({
        id: course.id,
        name: course.name,
        course_code: course.course_code,
        enrollment_term_id: course.enrollment_term_id,
        workflow_state: course.workflow_state
      }))
    });
  } catch (e) {
    console.error('[canvas/courses]', e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
