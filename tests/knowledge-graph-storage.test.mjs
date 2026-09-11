import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after, afterEach, before, test } from 'node:test';
import { knowledgeGraph } from './fixtures/knowledge-graph-v2.mjs';

let storageHome, store;
const previousHome = process.env.COURSE_COPILOT_HOME;
const savers = new Set();
const outline = [
  { id: 'ch1', title: '第一章', page: 7, level: 0 },
  { id: 'sec11', title: '1.1', page: 8, level: 1 },
  { id: 'sec12', title: '1.2', page: 12, level: 1 },
  { id: 'ch2', title: '第二章', page: 20, level: 0 },
];
before(async () => {
  storageHome = await mkdtemp(join(tmpdir(), 'course-kg-storage-'));
  process.env.COURSE_COPILOT_HOME = storageHome;
  store = await import('../server/course-store.mjs');
});
afterEach(() => { for (const save of savers) save.dispose(); savers.clear(); });
after(async () => {
  if (previousHome === undefined) delete process.env.COURSE_COPILOT_HOME;
  else process.env.COURSE_COPILOT_HOME = previousHome;
  if (storageHome) await rm(storageHome, { recursive: true, force: true });
});
async function fixture() {
  const course = await store.importCourse(Readable.from([Buffer.from('%PDF-1.4\nKG storage test\n%%EOF')]), `kg-${randomUUID()}.pdf`);
  await store.updateTextbook(course.id, { totalPages: 60, chapters: outline });
  return course;
}
async function saver(course, extra = {}) {
  const save = await store.createGeneratedArtifactSaver(course.id, {
    skillId: 'knowledge-graph', page: 15, scope: 'section', chapter: outline[2],
    book: { id: course.id, totalPages: 999 }, prompt: '', selectedText: '', pageText: '', history: [], ...extra,
  });
  savers.add(save);
  return save;
}
async function outputPath(course, filename) {
  return join((await store.getCoursePaths(course.id)).outputsDir, filename);
}

test('new graphs retain evidence, conditions, depth and authoritative source through disk reload', async () => {
  const course = await fixture();
  const graph = knowledgeGraph(randomUUID(), { detailLevel: 'detailed', source: { scope: 'book', page: 1 } });
  const saved = await (await saver(course))(graph);
  assert.deepEqual(saved.source, { scope: 'section', page: 15, chapterId: 'ch1', sectionId: 'sec12' });
  assert.equal(saved.detailLevel, 'detailed');
  assert.deepEqual(saved.edges, graph.edges);
  assert.deepEqual(saved.coverage, graph.coverage);
  assert.deepEqual(saved.nodes, graph.nodes);
  assert.deepEqual((await store.getState(course.id)).artifacts, [saved]);
  const disk = JSON.parse(await readFile(await outputPath(course, `result-${saved.id}.json`), 'utf8'));
  assert.deepEqual(disk, saved);
  assert.deepEqual(graph.source, { scope: 'book', page: 1 }, 'incoming request is not mutated');
});

test('all scope modes capture real course outline membership, including explicit same-page selections', async () => {
  const course = await fixture();
  for (const [scope, chapter, source] of [
    ['book', undefined, { scope: 'book', page: 15 }],
    ['chapter', outline[0], { scope: 'chapter', page: 15, chapterId: 'ch1' }],
    ['section', outline[1], { scope: 'section', page: 15, chapterId: 'ch1', sectionId: 'sec11' }],
    ['selection', undefined, { scope: 'selection', page: 15, chapterId: 'ch1', sectionId: 'sec12' }],
    ['page', undefined, { scope: 'page', page: 15, chapterId: 'ch1', sectionId: 'sec12' }],
  ]) {
    const saved = await (await saver(course, { scope, chapter }))(knowledgeGraph(randomUUID()));
    assert.deepEqual(saved.source, source);
  }
});

test('legacy graphs stay readable, but every new generated graph must pass v2 validation', async () => {
  const course = await fixture();
  const legacy = { id: 'old', title: '已有图谱', kind: 'knowledge-graph', nodes: [{ id: 'one', label: '旧概念', page: 10 }], edges: [] };
  await store.saveArtifact(course.id, legacy);
  assert.deepEqual((await store.getState(course.id)).artifacts, [legacy]);
  await assert.rejects((await saver(course))({ ...legacy, id: 'new' }), /v2|版本|schemaVersion|新版/i);
  assert.deepEqual((await store.getState(course.id)).artifacts, [legacy]);
});

test('missing evidence and pages outside the stored PDF bounds are rejected regardless of client page count', async () => {
  const course = await fixture();
  for (const mutate of [
    graph => { graph.edges[0].evidence = []; },
    graph => { graph.edges[0].evidence[0].page = 61; },
    graph => { graph.nodes[0].page = 61; },
    graph => { graph.coverage.items[0].pages = [61]; },
  ]) {
    const graph = knowledgeGraph(randomUUID()); mutate(graph);
    await assert.rejects((await saver(course))(graph), /证据|evidence|页|page/i);
  }
  assert.deepEqual((await store.getState(course.id)).artifacts, []);
});

test('pending files do not enter the library until validated and saved', async () => {
  const course = await fixture();
  const graph = knowledgeGraph('draft');
  await writeFile(await outputPath(course, 'pending-draft.json'), JSON.stringify(graph));
  assert.deepEqual((await store.getState(course.id)).artifacts, []);
  const saved = await (await saver(course))(graph);
  assert.deepEqual((await store.getState(course.id)).artifacts, [saved]);
});

test('an Agent bypassing the pending-file contract cannot leave a rejected graph in the library', async () => {
  const course = await fixture();
  const save = await saver(course);
  const legacy = { id: 'rejected', title: '不合格的新图谱', kind: 'knowledge-graph', nodes: [{ id: 'one', label: '概念' }], edges: [] };
  await writeFile(await outputPath(course, 'result-rejected.json'), JSON.stringify(legacy));
  await assert.rejects(save(legacy));
  assert.deepEqual((await store.getState(course.id)).artifacts, []);
  const files = await readdir((await store.getCoursePaths(course.id)).outputsDir);
  assert.ok(files.some(name => name.startsWith('rejected-rejected-')));
  assert.ok(!files.includes('result-rejected.json'));
});

test('a rejected rewrite restores the complete previous graph, including all evidence', async () => {
  const course = await fixture();
  const original = await (await saver(course))(knowledgeGraph('original'));
  const save = await saver(course);
  const invalid = structuredClone(original); invalid.edges[0].evidence = [];
  await writeFile(await outputPath(course, 'result-original.json'), JSON.stringify(invalid));
  await assert.rejects(save(invalid));
  assert.deepEqual((await store.getState(course.id)).artifacts, [original]);
});

test('finalization handles no-artifact runs: hides rogue outputs and restores overwritten historical files', async () => {
  const course = await fixture();
  const original = await (await saver(course))(knowledgeGraph('original'));
  const save = await saver(course);
  const rogue = { id: 'rogue', title: 'Agent沿用旧路径', kind: 'knowledge-graph', nodes: [{ id: 'one', label: '概念' }], edges: [] };
  await writeFile(await outputPath(course, 'result-rogue.json'), JSON.stringify(rogue));
  await writeFile(await outputPath(course, 'result-original.json'), '{unfinished');
  assert.deepEqual((await store.getState(course.id)).artifacts, [original], 'drafts and overwrites are hidden while running');
  // The Agent never returns an artifact event, e.g. abort, malformed pending, or no pending file.
  await save.finalize();
  save.dispose();
  assert.deepEqual(JSON.parse(await readFile(await outputPath(course, 'result-original.json'), 'utf8')), original);
  const files = await readdir((await store.getCoursePaths(course.id)).outputsDir);
  assert.ok(!files.includes('result-rogue.json'));
  assert.ok(files.some(name => name.startsWith('rejected-') && name.endsWith('result-rogue.json')));
});

test('finalization retains legitimately saved artifacts and user changes made during the run', async () => {
  const course = await fixture();
  const original = { id: 'map', title: '带补充的导图', kind: 'mindmap', nodes: [{ id: 'one', label: '原文', userText: '' }], edges: [] };
  await store.saveArtifact(course.id, original);
  const save = await saver(course);
  const edited = await store.updateMindmapNode(course.id, 'map', 'one', { userText: '生成期间的新补充' });
  const saved = await save(knowledgeGraph('accepted'));
  await writeFile(await outputPath(course, 'result-map.json'), JSON.stringify(original));
  await save.finalize();
  assert.deepEqual(JSON.parse(await readFile(await outputPath(course, 'result-map.json'), 'utf8')), edited);
  assert.deepEqual(JSON.parse(await readFile(await outputPath(course, 'result-accepted.json'), 'utf8')), saved);
});

test('page metadata arriving after generation starts is used at save time', async () => {
  const course = await store.importCourse(Readable.from([Buffer.from('%PDF-1.4\nlate metadata\n%%EOF')]), `late-${randomUUID()}.pdf`);
  const save = await saver(course);
  await store.updateTextbook(course.id, { totalPages: 60, chapters: outline });
  const saved = await save(knowledgeGraph('late-loaded'));
  assert.equal(saved.edges[0].evidence[0].page, 11);
  assert.deepEqual(saved.source, { scope: 'section', page: 15, chapterId: 'ch1', sectionId: 'sec12' });
});

test('finalization preserves exact old file bytes and does not move pre-existing unreadable results', async () => {
  const course = await fixture();
  const oldBytes = '{"id":"old","title":"旧导图","kind":"mindmap","nodes":[{"id":"a","label":"原文"}],"edges":[]}\n\n';
  const oldPath = await outputPath(course, 'result-old.json');
  const unreadablePath = await outputPath(course, 'result-unreadable.json');
  await writeFile(oldPath, oldBytes);
  await writeFile(unreadablePath, '{pre-existing unfinished file');
  const save = await saver(course);
  await save.finalize();
  assert.equal(await readFile(oldPath, 'utf8'), oldBytes);
  assert.equal(await readFile(unreadablePath, 'utf8'), '{pre-existing unfinished file');
  await writeFile(oldPath, 'broken during generation');
  await save.finalize();
  assert.equal(await readFile(oldPath, 'utf8'), oldBytes, 'restoration also preserves the original representation');
});

test('chat revisions inherit the saved graph scope and ignore forged client scope', async () => {
  const course = await fixture();
  const original = await (await saver(course))(knowledgeGraph('original'));
  const request = { skillId: 'chat', scope: 'page', page: 21, artifact: { ...original, source: { scope: 'book', page: 1 } } };
  const revised = await (await saver(course, request))(knowledgeGraph('revised'));
  assert.deepEqual(revised.source, original.source);
  const newGraph = await (await saver(course, { ...request, artifact: { ...request.artifact, id: 'not-saved' } }))(knowledgeGraph('untrusted-context'));
  assert.equal(newGraph.source, undefined, 'unverified old scope is not invented from the currently viewed page');
});

test('course concept catalog preserves identifiers, aliases and meaning variants for later generations', async () => {
  const course = await fixture();
  const first = knowledgeGraph('first');
  await (await saver(course))(first);
  const other = knowledgeGraph('other');
  other.nodes[0].conceptKey = 'ml.svm.soft-margin';
  other.nodes[0].label = '软边距支持向量机';
  other.nodes[0].aliases = ['软边距 SVM'];
  await (await saver(course))(other);
  const save = await saver(course);
  const catalog = JSON.parse(await readFile(save.knowledgeGraphContext.conceptCatalogPath, 'utf8'));
  assert.equal(catalog.concepts.length, 3, 'the same task is deduplicated; the two model variants remain distinct');
  const svm = catalog.concepts.find(node => node.conceptKey === 'ml.svm');
  assert.deepEqual(svm.aliases, ['SVM', '支撑向量机']);
  assert.ok(catalog.concepts.some(node => node.conceptKey === 'ml.svm.soft-margin'));
  assert.equal(catalog.concepts.some(node => Object.hasOwn(node, 'evidence')), false, 'naming hints are not relation evidence');
  assert.equal((await store.getState(course.id)).artifacts.length, 2, 'the catalog is not listed as an artifact');
});
