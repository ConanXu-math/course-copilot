import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after, afterEach, before, test } from 'node:test';
import { knowledgeGraph } from './fixtures/knowledge-graph-v2.mjs';

let storageHome;
let store;
const previousHome = process.env.COURSE_COPILOT_HOME;
const generationSavers = new Set();

before(async () => {
  storageHome = await mkdtemp(join(tmpdir(), 'course-copilot-source-test-'));
  process.env.COURSE_COPILOT_HOME = storageHome;
  // The module captures this setting on import; keep every test out of the real library.
  store = await import('../server/course-store.mjs');
});

after(async () => {
  if (previousHome === undefined) delete process.env.COURSE_COPILOT_HOME;
  else process.env.COURSE_COPILOT_HOME = previousHome;
  if (storageHome) await rm(storageHome, { recursive: true, force: true });
});

afterEach(() => {
  for (const save of generationSavers) save.dispose();
  generationSavers.clear();
});

async function createSaver(courseId, value) {
  const save = await store.createGeneratedArtifactSaver(courseId, value);
  generationSavers.add(save);
  return save;
}

const outline = [
  { id: 'chapter-1', title: '第一章', page: 7, level: 0 },
  { id: 'section-1-1', title: '1.1', page: 8, level: 1 },
  { id: 'section-1-2', title: '1.2', page: 12, level: 1 },
  { id: 'subsection-1-2-1', title: '1.2.1', page: 14, level: 2 },
  { id: 'chapter-2', title: '第二章', page: 20, level: 0 },
  { id: 'section-2-1', title: '2.1', page: 22, level: 1 },
  { id: 'chapter-3', title: '第三章', page: 40, level: 0 },
];

async function fixture(chapters = outline) {
  const course = await store.importCourse(
    Readable.from([Buffer.from('%PDF-1.4\nsource metadata test\n%%EOF\n')]),
    `source-test-${randomUUID()}.pdf`,
  );
  await store.updateTextbook(course.id, { totalPages: 60, chapters: structuredClone(chapters) });
  return course;
}

function mindmap(id = randomUUID(), extra = {}) {
  return {
    id, kind: 'mindmap', title: '思维导图',
    nodes: [{ id: 'root', label: '主题', userText: '', page: 15 }, { id: 'child', label: '知识点', userText: '', page: 16 }],
    edges: [{ source: 'root', target: 'child', label: '包含' }],
    metadata: { retained: true },
    ...extra,
  };
}

function request(course, extra = {}) {
  return {
    skillId: 'mindmap', book: { id: course.id, title: course.title, filename: course.filename },
    scope: 'page', page: 15, selectedText: '', pageText: '', prompt: '', history: [],
    ...extra,
  };
}

async function generated(course, context, artifact = mindmap()) {
  const save = await createSaver(course.id, request(course, context));
  const saved = await save(artifact);
  const state = await store.getState(course.id);
  assert.deepEqual(state.artifacts.find(item => item.id === saved.id), saved);
  return saved;
}

async function resultPath(course, id) {
  const { outputsDir } = await store.getCoursePaths(course.id);
  return join(outputsDir, `result-${encodeURIComponent(id)}.json`);
}

const currentSource = { scope: 'page', page: 15, chapterId: 'chapter-1', sectionId: 'section-1-2' };
const oldSource = { scope: 'chapter', page: 9, chapterId: 'chapter-1' };
const forgedSource = { scope: 'book', page: 1 };

test('all five scopes keep the request page and include only the applicable outline identifiers', async () => {
  const course = await fixture();
  for (const [context, source] of [
    [{ scope: 'page' }, currentSource],
    [{ scope: 'selection' }, { ...currentSource, scope: 'selection' }],
    [{ scope: 'section', chapter: outline[2] }, { ...currentSource, scope: 'section' }],
    [{ scope: 'chapter', chapter: outline[0] }, { scope: 'chapter', page: 15, chapterId: 'chapter-1' }],
    [{ scope: 'book', chapter: outline[2] }, { scope: 'book', page: 15 }],
  ]) {
    const artifact = mindmap();
    const saved = await generated(course, context, artifact);
    assert.deepEqual(saved, { ...artifact, source });
  }
});

test('page attribution respects chapter openings, front matter, and chapters without sections', async () => {
  const course = await fixture();
  for (const [page, source] of [
    [1, { scope: 'page', page: 1 }],
    [7, { scope: 'page', page: 7, chapterId: 'chapter-1' }],
    [20, { scope: 'page', page: 20, chapterId: 'chapter-2' }],
    [22, { scope: 'page', page: 22, chapterId: 'chapter-2', sectionId: 'section-2-1' }],
    [45, { scope: 'page', page: 45, chapterId: 'chapter-3' }],
  ]) {
    const saved = await generated(course, { page, chapter: outline[2] });
    assert.deepEqual(saved.source, source, 'page scope uses page membership rather than a supplied chapter');
  }
});

test('section and chapter IDs use persisted levels and pages, with page-based fallback for invalid selections', async () => {
  const course = await fixture();
  const selected = await generated(course, {
    scope: 'section', chapter: { ...outline[1], page: 999, level: 99, title: '不可信标题' },
  });
  assert.deepEqual(selected.source, { scope: 'section', page: 15, chapterId: 'chapter-1', sectionId: 'section-1-1' });

  for (const chapter of [
    { id: 'invented-section', page: 1, level: 1 },
    { ...outline[0], level: 1 },
    { ...outline[3], level: 1 },
    { ...outline[5], page: 1 },
  ]) {
    const saved = await generated(course, { scope: 'section', chapter });
    assert.deepEqual(saved.source, { ...currentSource, scope: 'section' });
  }
  for (const chapter of [{ id: 'invented-chapter', page: 1, level: 0 }, { ...outline[2], level: 0 }]) {
    const saved = await generated(course, { scope: 'chapter', chapter });
    assert.deepEqual(saved.source, { scope: 'chapter', page: 15, chapterId: 'chapter-1' });
  }
  const realChapter = await generated(course, { scope: 'chapter', chapter: { ...outline[0], page: 999, level: 5 } });
  assert.deepEqual(realChapter.source, { scope: 'chapter', page: 15, chapterId: 'chapter-1' });
});

test('an explicit section ID distinguishes adjacent sections that start on the same page', async () => {
  const samePageOutline = structuredClone(outline);
  samePageOutline.splice(3, 0, { id: 'section-1-3', title: '1.3', page: 12, level: 1 });
  const course = await fixture(samePageOutline);
  for (const sectionId of ['section-1-2', 'section-1-3']) {
    const saved = await generated(course, { scope: 'section', chapter: { id: sectionId, level: 99, page: 999 } });
    assert.deepEqual(saved.source, { scope: 'section', page: 15, chapterId: 'chapter-1', sectionId });
  }
});

test('an unknown outline preserves scope and page without inventing IDs from the request', async () => {
  const course = await fixture([]);
  for (const scope of ['page', 'selection', 'section', 'chapter', 'book']) {
    const saved = await generated(course, { scope, chapter: outline[2] });
    assert.deepEqual(saved.source, { scope, page: 15 });
  }
});

test('model-supplied source is ignored even when the model writes its result file before returning', async () => {
  const course = await fixture();
  const artifact = mindmap('new-result', { source: forgedSource });
  const save = await createSaver(course.id, request(course));
  await writeFile(await resultPath(course, artifact.id), JSON.stringify(artifact));
  const saved = await save(artifact);
  assert.deepEqual(saved, { ...artifact, source: currentSource });
  assert.deepEqual(JSON.parse(await readFile(await resultPath(course, artifact.id), 'utf8')), saved);
  const direct = await generated(course, {}, mindmap('direct-result', { source: forgedSource }));
  assert.deepEqual(direct.source, currentSource);
});

test('same-ID updates retain the source captured before model file writes', async () => {
  const course = await fixture();
  const original = await store.saveArtifact(course.id, mindmap('existing', { source: oldSource }));
  const save = await createSaver(course.id, request(course, { scope: 'section', page: 23 }));
  const replacement = mindmap(original.id, { title: '更新后的导图', source: forgedSource });
  replacement.nodes[0].label = '更新后的主题';
  await writeFile(await resultPath(course, original.id), JSON.stringify(replacement));
  const saved = await save(replacement);
  const expected = { ...replacement, source: oldSource, nodes: structuredClone(original.nodes) };
  assert.deepEqual(saved, expected, 'same-ID regeneration also preserves existing original node text');
  assert.deepEqual(JSON.parse(await readFile(await resultPath(course, original.id), 'utf8')), saved);

  // The wrapper adds provenance policy; ordinary saveArtifact remains a direct replacement.
  const directlySaved = await store.saveArtifact(course.id, { ...saved, source: currentSource });
  assert.deepEqual(directlySaved.source, currentSource);
});

test('an existing legacy map without source does not make a later model-provided source trusted', async () => {
  const course = await fixture();
  for (const scope of ['book', 'section']) {
    const legacy = await store.saveArtifact(course.id, mindmap(`legacy-${scope}`));
    const save = await createSaver(course.id, request(course, { scope }));
    const replacement = { ...legacy, source: forgedSource };
    await writeFile(await resultPath(course, legacy.id), JSON.stringify(replacement));
    const saved = await save(replacement);
    assert.deepEqual(saved, legacy, 'unknown historical scope must not be inferred from the new request');
    assert.equal(Object.hasOwn(saved, 'source'), false);
  }
});

test('chat continuations inherit the disk source for a new ID and use request source only when unavailable on disk', async () => {
  const course = await fixture();
  const original = await store.saveArtifact(course.id, mindmap('chat-original', { source: oldSource }));
  const save = await createSaver(course.id, request(course, {
    skillId: 'chat', scope: 'book', artifact: { ...original, source: forgedSource },
  }));
  await writeFile(await resultPath(course, original.id), JSON.stringify({ ...original, source: forgedSource }));
  const continuation = await save(mindmap('chat-new', { source: forgedSource }));
  assert.deepEqual(continuation.source, oldSource);

  const fallback = await generated(course, {
    skillId: 'chat', scope: 'book', artifact: mindmap('not-on-disk', { source: oldSource }),
  });
  assert.deepEqual(fallback.source, oldSource);
});

test('chat continuations of legacy maps keep their unknown scope instead of using the reading location', async () => {
  const course = await fixture();
  const legacy = await store.saveArtifact(course.id, mindmap('legacy-chat'));
  for (const artifact of [legacy, { ...legacy, source: forgedSource }, mindmap('legacy-not-on-disk')]) {
    const saved = await generated(course, { skillId: 'chat', scope: 'section', page: 23, artifact },
      mindmap(randomUUID(), { source: forgedSource }));
    assert.equal(Object.hasOwn(saved, 'source'), false);
  }
});

test('new scope generations and references of another kind do not inherit a previous map source', async () => {
  const course = await fixture();
  const original = await store.saveArtifact(course.id, mindmap('old-map', { source: oldSource }));
  const scoped = await generated(course, { skillId: 'mindmap', artifact: original });
  assert.deepEqual(scoped.source, currentSource);

  const graph = await store.saveArtifact(course.id, mindmap('graph', { kind: 'knowledge-graph', source: oldSource }));
  const fromGraph = await generated(course, { skillId: 'chat', artifact: graph });
  assert.deepEqual(fromGraph.source, currentSource);
  const replacingGraph = await generated(course, { skillId: 'chat', artifact: graph }, mindmap(graph.id));
  assert.deepEqual(replacingGraph.source, currentSource);

  const savedGraph = await generated(course, { skillId: 'chat', artifact: original }, knowledgeGraph('new-graph'));
  assert.equal(Object.hasOwn(savedGraph, 'source'), false);
  const markdown = await generated(course, { skillId: 'chat', artifact: original }, {
    id: 'text-output', kind: 'markdown', title: '说明', content: '这是说明文字',
  });
  assert.equal(Object.hasOwn(markdown, 'source'), false);
});

test('node edits and stale state or history saves preserve authoritative source metadata', async () => {
  const course = await fixture();
  const artifact = await generated(course, { scope: 'section', chapter: outline[2] });
  const staleArtifact = { ...structuredClone(artifact), source: forgedSource };
  const stale = {
    page: 15, bookmarks: [], notes: [], conversationId: 'current',
    artifacts: [staleArtifact],
    messages: [{ id: 'answer', role: 'assistant', content: '导图', artifacts: [staleArtifact] }],
  };
  await store.saveState(course.id, { ...structuredClone(stale), conversationId: 'history' });
  await store.saveState(course.id, structuredClone(stale));
  const edited = await store.updateMindmapNode(course.id, artifact.id, 'root', { userText: '主题的用户补充' });
  assert.equal(edited.nodes[0].label, artifact.nodes[0].label);
  assert.equal(edited.nodes[0].userText, '主题的用户补充');
  assert.deepEqual(edited.source, artifact.source);
  const saved = await store.saveState(course.id, { ...structuredClone(stale), page: 16 });
  assert.equal(saved.page, 16);
  assert.deepEqual(saved.artifacts, [edited]);
  assert.deepEqual(saved.messages[0].artifacts, [edited]);
  for (const conversationId of ['current', 'history']) {
    const history = await store.getConversation(course.id, conversationId);
    assert.deepEqual(history.messages[0].artifacts, [edited]);
  }
});

test('legacy mindmaps remain readable when source is absent or malformed', async () => {
  const course = await fixture();
  const invalidSources = [
    undefined, null, false, [], 'page', {},
    { scope: 'unknown', page: 15 }, { scope: 'page' },
    { scope: 'page', page: 0 }, { scope: 'page', page: -1 }, { scope: 'page', page: 1.5 },
    { scope: 'page', page: '15' }, { scope: 'page', page: null },
    { scope: 'page', page: Number.MAX_SAFE_INTEGER + 1 },
    { scope: 'page', page: 15, chapterId: 1 }, { scope: 'page', page: 15, chapterId: '' },
    { scope: 'section', page: 15, sectionId: false }, { scope: 'section', page: 15, sectionId: '   ' },
  ];
  const expected = [];
  for (const [index, source] of invalidSources.entries()) {
    const artifact = mindmap(`legacy-${index}`);
    const malformed = { ...artifact, ...(source === undefined ? {} : { source }) };
    const normalized = await store.saveArtifact(course.id, malformed);
    assert.deepEqual(normalized, artifact, `invalid source ${index} is discarded without discarding the map`);
    // Simulate pre-existing files, which must also normalize at read time.
    await writeFile(await resultPath(course, artifact.id), JSON.stringify(malformed));
    expected.push(artifact);
  }
  const state = await store.getState(course.id);
  assert.equal(state.artifacts.length, expected.length);
  for (const artifact of expected) {
    assert.deepEqual(state.artifacts.find(item => item.id === artifact.id), artifact);
  }
});
