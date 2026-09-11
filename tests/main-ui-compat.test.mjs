import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after, afterEach, before, test } from 'node:test';
import { knowledgeGraph } from './fixtures/knowledge-graph-v2.mjs';

let storageHome, store, middleware;
const previousHome = process.env.COURSE_COPILOT_HOME;
const savers = new Set();
const outline = [
  { id: 'ch1', title: '第一章', page: 1, level: 0 },
  { id: 'sec12', title: '1.2', page: 12, level: 1 },
];

before(async () => {
  storageHome = await mkdtemp(join(tmpdir(), 'course-main-ui-compat-'));
  process.env.COURSE_COPILOT_HOME = storageHome;
  store = await import('../server/course-store.mjs');
  middleware = (await import('../server/api.mjs')).createApiMiddleware();
});
afterEach(() => { for (const save of savers) save.dispose(); savers.clear(); });
after(async () => {
  if (previousHome === undefined) delete process.env.COURSE_COPILOT_HOME;
  else process.env.COURSE_COPILOT_HOME = previousHome;
  if (storageHome) await rm(storageHome, { recursive: true, force: true });
});

async function fixture() {
  const course = await store.importCourse(Readable.from([Buffer.from('%PDF-1.4\ncompat fixture\n%%EOF')]), `compat-${randomUUID()}.pdf`);
  await store.updateTextbook(course.id, { totalPages: 60, chapters: outline });
  return { course, ...(await store.getCoursePaths(course.id)) };
}

function request(course, extra = {}) {
  return {
    skillId: 'slides', book: { id: course.id, title: course.title, filename: course.filename },
    scope: 'section', page: 15, chapter: outline[1], selectedText: '', pageText: '', prompt: '', history: [],
    templateId: 'ivory', knowledgeGraphDetail: 'detailed', ...extra,
  };
}

async function saver(course, extra = {}) {
  const save = await store.createGeneratedArtifactSaver(course.id, request(course, extra));
  savers.add(save);
  return save;
}

async function slideFiles(outputsDir) {
  await mkdir(join(outputsDir, 'slides-fixture'));
  await writeFile(join(outputsDir, 'slides-fixture', '第一章.pdf'), '%PDF-1.4\nslide fixture\n%%EOF');
  await writeFile(join(outputsDir, 'slides-fixture', '源码.zip'), 'synthetic archive path fixture');
  return {
    id: randomUUID(), kind: 'slides', title: '第一章课件', templateId: 'ivory',
    chapters: [{ title: '第一章', url: join(outputsDir, 'slides-fixture', '第一章.pdf'), filename: '第一章.pdf' }],
    sourceUrl: 'outputs/slides-fixture/源码.zip',
  };
}

test('chapter PDFs and LaTeX source ZIP survive pending promotion and a fresh library read', async () => {
  const { course, outputsDir } = await fixture();
  const artifact = await slideFiles(outputsDir);
  const draft = join(outputsDir, `pending-${artifact.id}.json`);
  await writeFile(draft, JSON.stringify(artifact));
  assert.deepEqual((await store.getState(course.id)).artifacts, []);
  const save = await saver(course);
  const saved = await save(JSON.parse(await readFile(draft, 'utf8')));
  assert.equal(saved.templateId, 'ivory');
  assert.equal(saved.sourceUrl, store.outputUrl(course.id, 'slides-fixture/源码.zip'));
  assert.deepEqual(saved.chapters, [{ ...artifact.chapters[0], url: store.outputUrl(course.id, 'slides-fixture/第一章.pdf') }]);
  await save.finalize();
  save.dispose();
  assert.deepEqual((await store.getState(course.id)).artifacts, [saved]);
  assert.deepEqual(JSON.parse(await readFile(join(outputsDir, `result-${artifact.id}.json`), 'utf8')), saved);
});

test('both chapter PDF and source ZIP must be existing files inside this course outputs', async () => {
  const { course, outputsDir } = await fixture();
  const artifact = await slideFiles(outputsDir);
  for (const field of ['chapter', 'source']) {
    const ext = field === 'chapter' ? 'pdf' : 'zip';
    for (const url of [
      `https://example.test/file.${ext}`,
      `/api/courses/another-course/outputs/file.${ext}`,
      `../file.${ext}`,
      `/api/courses/${encodeURIComponent(course.id)}/outputs/%2e%2e/file.${ext}`,
      `outputs/missing.${ext}`,
    ]) {
      const invalid = structuredClone(artifact);
      invalid.id = randomUUID();
      if (field === 'chapter') invalid.chapters[0].url = url;
      else invalid.sourceUrl = url;
      await assert.rejects((await saver(course))(invalid), error => error.status === 400);
    }
  }
  assert.deepEqual((await store.getState(course.id)).artifacts, []);
});

test('chapter PDFs and source ZIP cannot escape through a symlink', async () => {
  const { course, outputsDir } = await fixture();
  const artifact = await slideFiles(outputsDir);
  for (const [field, ext] of [['chapter', 'pdf'], ['source', 'zip']]) {
    const outside = join(storageHome, `outside.${ext}`);
    await writeFile(outside, 'outside output root');
    await symlink(outside, join(outputsDir, `linked.${ext}`));
    const invalid = structuredClone(artifact);
    invalid.id = randomUUID();
    if (field === 'chapter') invalid.chapters[0].url = `linked.${ext}`;
    else invalid.sourceUrl = `linked.${ext}`;
    await assert.rejects((await saver(course))(invalid));
  }
  assert.deepEqual((await store.getState(course.id)).artifacts, []);
});

test('slide template parameters leave graph v2, evidence and authoritative scope intact', async () => {
  const { course } = await fixture();
  const graph = knowledgeGraph(randomUUID(), { detailLevel: 'detailed', source: { scope: 'book', page: 1 } });
  const save = await saver(course, { skillId: 'knowledge-graph' });
  const saved = await save(graph);
  assert.deepEqual(saved.source, { scope: 'section', page: 15, chapterId: 'ch1', sectionId: 'sec12' });
  assert.equal(saved.detailLevel, 'detailed');
  assert.deepEqual(saved.edges, graph.edges);
  const invalid = knowledgeGraph(randomUUID());
  invalid.edges[0].evidence = [];
  await assert.rejects(save(invalid), /evidence|依据|证据/i);
  assert.deepEqual((await store.getState(course.id)).artifacts, [saved]);
});

function postRun(value) {
  return new Promise((resolve, reject) => {
    const req = Readable.from([Buffer.from(JSON.stringify(value))]);
    req.url = '/api/agent/run';
    req.method = 'POST';
    req.headers = { 'content-type': 'application/json' };
    const res = {
      writeHead(status) { this.status = status; this.headersSent = true; },
      end(body) { resolve({ status: this.status, body: JSON.parse(body) }); },
      destroy: reject,
    };
    middleware(req, res);
  });
}

test('the API accepts main slide templates together with graph depth and rejects either invalid setting', async () => {
  const { course } = await fixture();
  for (const templateId of ['navy', 'ivory', 'banner']) {
    const valid = await postRun(request(course, { skillId: 'knowledge-graph', templateId }));
    // No real Agent is connected in this isolated test. Reaching 503 establishes
    // that the complete UI request passed validation without running a model.
    assert.equal(valid.status, 503);
  }
  assert.equal((await postRun(request(course, { templateId: 'unknown' }))).status, 400);
  assert.equal((await postRun(request(course, { knowledgeGraphDetail: 'unknown' }))).status, 400);
});
