import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after, afterEach, before, test } from 'node:test';

let storageHome;
let store;
let handleCourseApi;
const previousHome = process.env.COURSE_COPILOT_HOME;
const generationSavers = new Set();

before(async () => {
  storageHome = await mkdtemp(join(tmpdir(), 'course-copilot-mindmap-test-'));
  process.env.COURSE_COPILOT_HOME = storageHome;
  // The store captures its home at module load time. Never statically import it here.
  store = await import('../server/course-store.mjs');
  ({ handleCourseApi } = await import('../server/course-api.mjs'));
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

function mindmap(kind = 'mindmap', id = 'map') {
  return {
    id,
    kind,
    title: '最优化方法',
    page: 8,
    metadata: { source: 'textbook', tags: ['凸性', '梯度'], version: 1 },
    layout: { direction: 'LR' },
    nodes: [
      { id: 'root', label: '原始主题', userText: '', page: 8, depth: 0, metadata: { color: 'blue' } },
      { id: 'child', label: '原始子主题', userText: '', page: 12, depth: 1, annotation: '保持此字段' },
      { id: 'leaf', label: '未修改的知识点', userText: '', page: 18, depth: 2 },
    ],
    edges: [
      { source: 'root', target: 'child', label: '包含', weight: 2 },
      { source: 'child', target: 'leaf', label: '推导' },
    ],
  };
}

async function fixture(kind = 'mindmap', artifactId = 'map') {
  const course = await store.importCourse(
    Readable.from([Buffer.from('%PDF-1.4\nmock textbook for storage tests\n%%EOF\n')]),
    `mindmap-test-${randomUUID()}.pdf`,
  );
  const artifact = await store.saveArtifact(course.id, mindmap(kind, artifactId));
  return { course, artifact };
}

function node(artifact, id = 'root') {
  return artifact.nodes.find((item) => item.id === id);
}

async function persistedArtifact(course, artifactId = 'map') {
  const state = await store.getState(course.id);
  const artifact = state.artifacts.find((item) => item.id === artifactId);
  assert.ok(artifact, 'artifact remains available in course state');
  return artifact;
}

function expectStatus(status) {
  return (error) => {
    assert.equal(error.status, status);
    assert.ok(error.message);
    return true;
  };
}

async function request(url, value, method = 'PATCH') {
  const req = Readable.from([Buffer.from(JSON.stringify(value))]);
  req.url = url;
  req.method = method;
  req.headers = { 'content-type': 'application/json' };
  const res = {
    destroyed: false,
    writableEnded: false,
    headersSent: false,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      this.headersSent = true;
    },
    end(value) {
      this.value = JSON.parse(value);
      this.writableEnded = true;
    },
  };
  assert.equal(await handleCourseApi(req, res), true);
  assert.equal(res.writableEnded, true, 'route completes its response');
  return res;
}

function nodeUrl(courseId, artifactId, nodeId) {
  return `/api/courses/${encodeURIComponent(courseId)}/artifacts/${encodeURIComponent(artifactId)}/nodes/${encodeURIComponent(nodeId)}`;
}

test('adding, revising, and clearing user text never change the original nodes or artifact structure', async () => {
  const { course, artifact } = await fixture();
  const first = await store.updateMindmapNode(course.id, artifact.id, 'root', { userText: '  第一次补充\n' });
  const expected = structuredClone(artifact);
  Object.assign(node(expected), { userText: '  第一次补充\n' });
  assert.deepEqual(first, expected, 'only the selected node gains supplemental text');
  assert.deepEqual(await persistedArtifact(course), expected);

  const second = await store.updateMindmapNode(course.id, artifact.id, 'root', { userText: '第二次补充' });
  Object.assign(node(expected), { userText: '第二次补充' });
  assert.deepEqual(second, expected);
  assert.deepEqual(await persistedArtifact(course), expected);

  const cleared = await store.updateMindmapNode(course.id, artifact.id, 'root', { userText: '' });
  assert.equal(node(cleared).userText ?? '', '');
  assert.deepEqual(node(cleared), node(artifact));
  assert.deepEqual(cleared.nodes.slice(1), artifact.nodes.slice(1));
  assert.deepEqual(cleared.edges, artifact.edges);
  assert.equal(Object.hasOwn(node(cleared), 'originalLabel'), false);
  assert.deepEqual(await persistedArtifact(course), cleared);
});

test('saving unchanged supplemental text never creates an original-label marker', async () => {
  const { course, artifact } = await fixture();
  const empty = await store.updateMindmapNode(course.id, artifact.id, 'root', { userText: '' });
  assert.equal(node(empty).label, node(artifact).label);
  assert.equal(node(empty).userText ?? '', '');
  const edited = await store.updateMindmapNode(course.id, artifact.id, 'root', { userText: '补充内容' });
  const unchanged = await store.updateMindmapNode(course.id, artifact.id, 'root', { userText: '补充内容' });
  assert.deepEqual(unchanged, edited);
  assert.equal(Object.hasOwn(node(unchanged), 'originalLabel'), false);
  assert.deepEqual(await persistedArtifact(course), edited);
});

test('supplemental Markdown indentation, trailing newlines, and whitespace survive API persistence', async () => {
  const { course, artifact } = await fixture();
  for (const userText of ['    const value = 1;\n    return value;\n', '\n- **重点**\n  - 补充\n', ' \t\n ']) {
    const response = await request(nodeUrl(course.id, artifact.id, 'root'), { userText });
    assert.equal(response.status, 200);
    assert.equal(node(response.value).userText, userText);
    assert.equal(node(response.value).label, node(artifact).label);
    assert.equal(Object.hasOwn(node(response.value), 'originalLabel'), false);
    assert.deepEqual(await persistedArtifact(course), response.value);
  }
});

test('original Markdown and boundary whitespace remain exact throughout supplemental edits', async () => {
  const { course, artifact } = await fixture();
  const originalLabel = '\n  **原始主题**\t \n    const value = 1;\n';
  node(artifact).label = originalLabel;
  await store.saveArtifact(course.id, artifact);
  for (const userText of ['', '\t追加说明\n', '**另一份补充**\n', '']) {
    const edited = await store.updateMindmapNode(course.id, artifact.id, 'root', { userText });
    assert.equal(node(edited).label, originalLabel);
    assert.equal(node(edited).userText ?? '', userText);
    assert.equal(Object.hasOwn(node(edited), 'originalLabel'), false);
    assert.deepEqual(await persistedArtifact(course), edited);
  }
});

test('missing course, artifact, and node return 404 without modifying existing data', async () => {
  const { course, artifact } = await fixture();
  for (const [courseId, artifactId, nodeId] of [
    ['missing-course', artifact.id, 'root'],
    [course.id, 'missing-artifact', 'root'],
    [course.id, artifact.id, 'missing-node'],
  ]) {
    await assert.rejects(store.updateMindmapNode(courseId, artifactId, nodeId, { userText: '补充' }), expectStatus(404));
    const response = await request(nodeUrl(courseId, artifactId, nodeId), { userText: '补充' });
    assert.equal(response.status, 404);
    assert.equal(typeof response.value.error, 'string');
  }
  assert.deepEqual(await persistedArtifact(course), artifact);
});

test('knowledge graphs cannot be edited through the mindmap-node endpoint', async () => {
  const { course, artifact } = await fixture('knowledge-graph');
  await assert.rejects(store.updateMindmapNode(course.id, artifact.id, 'root', { userText: '补充' }), expectStatus(400));
  const response = await request(nodeUrl(course.id, artifact.id, 'root'), { userText: '补充' });
  assert.equal(response.status, 400);
  assert.deepEqual(await persistedArtifact(course), artifact);
});

test('non-string, overlong, and original-text mutation payloads return 400 without changing the artifact', async () => {
  const { course, artifact } = await fixture();
  const invalid = [null, [], {}, { userText: null },
    { userText: 123 }, { userText: false }, { userText: ['text'] }, { userText: { text: 'text' } },
    { userText: 'x'.repeat(2001) }, { userText: ` ${'x'.repeat(2000)}` }, { userText: `${'x'.repeat(2000)}\n` },
    { label: '修改原文' }, { originalLabel: '替换原文' },
    { userText: '补充', label: '修改原文' }, { userText: '补充', originalLabel: '替换原文' },
    { userText: '', label: node(artifact).label }, { userText: '', originalLabel: null }];
  for (const value of invalid) {
    await assert.rejects(store.updateMindmapNode(course.id, artifact.id, 'root', value), expectStatus(400));
    const response = await request(nodeUrl(course.id, artifact.id, 'root'), value);
    assert.equal(response.status, 400);
    assert.equal(typeof response.value.error, 'string');
  }
  assert.deepEqual(await persistedArtifact(course), artifact);
  node(artifact).label = '原'.repeat(3000);
  await store.saveArtifact(course.id, artifact);
  const boundary = await store.updateMindmapNode(course.id, artifact.id, 'root', { userText: 'x'.repeat(2000) });
  assert.equal(node(boundary).userText.length, 2000, 'the maximum applies to supplemental text independently');
  assert.equal(node(boundary).label, node(artifact).label, 'long original text is retained without truncation');
});

test('old state and message snapshots cannot overwrite edits, and conversation reads hydrate current artifacts', async () => {
  const { course, artifact } = await fixture();
  const message = {
    id: 'answer', role: 'assistant', content: '这里是思维导图',
    artifacts: [structuredClone(artifact)], page: 8, metadata: { retained: true },
  };
  const stale = {
    page: 8, bookmarks: [8, 12], notes: [{ id: 'note', page: 8, content: '阅读笔记' }],
    conversationId: 'current', messages: [structuredClone(message)], artifacts: [structuredClone(artifact)],
  };
  await store.saveState(course.id, { ...structuredClone(stale), conversationId: 'history' });
  await store.saveState(course.id, structuredClone(stale));
  const edited = await store.updateMindmapNode(course.id, artifact.id, 'root', { userText: '磁盘中的最新补充' });
  assert.equal(node(edited).label, node(artifact).label);

  // Neither conversation has been saved since the edit; read-time hydration must repair both snapshots.
  const firstState = await store.getState(course.id);
  assert.deepEqual(firstState.artifacts, [edited]);
  assert.deepEqual(firstState.messages[0], { ...message, artifacts: [edited] });
  for (const conversationId of ['current', 'history']) {
    const conversation = await store.getConversation(course.id, conversationId);
    assert.deepEqual(conversation.messages[0], { ...message, artifacts: [edited] });
  }

  const saved = await store.saveState(course.id, { ...structuredClone(stale), page: 12 });
  assert.equal(saved.page, 12, 'reading progress still saves');
  assert.deepEqual(saved.bookmarks, stale.bookmarks);
  assert.deepEqual(saved.notes, stale.notes);
  assert.deepEqual(saved.artifacts, [edited]);
  assert.deepEqual(saved.messages[0], { ...message, artifacts: [edited] });
  assert.deepEqual(await persistedArtifact(course), edited);
  for (const conversationId of ['current', 'history']) {
    const conversation = await store.getConversation(course.id, conversationId);
    assert.deepEqual(conversation.messages[0].artifacts, [edited]);
  }
});

test('concurrent edits to different nodes in the same artifact are both persisted', async () => {
  const { course, artifact } = await fixture();
  await Promise.all([
    store.updateMindmapNode(course.id, artifact.id, 'root', { userText: '并发补充主题' }),
    store.updateMindmapNode(course.id, artifact.id, 'child', { userText: '并发补充子主题' }),
  ]);
  const expected = structuredClone(artifact);
  Object.assign(node(expected), { userText: '并发补充主题' });
  Object.assign(node(expected, 'child'), { userText: '并发补充子主题' });
  assert.deepEqual(await persistedArtifact(course), expected);
});

test('PATCH returns the complete updated artifact and handles encoded artifact and node identifiers', async () => {
  const { course, artifact } = await fixture('mindmap', '导图 / 1');
  artifact.nodes[0].id = '主题 / 1';
  artifact.edges[0].source = '主题 / 1';
  await store.saveArtifact(course.id, artifact);
  const response = await request(nodeUrl(course.id, artifact.id, '主题 / 1'), { userText: ' API 补充 ' });
  assert.equal(response.status, 200);
  assert.match(response.headers['Content-Type'], /application\/json/);
  const expected = structuredClone(artifact);
  Object.assign(node(expected, '主题 / 1'), { userText: ' API 补充 ' });
  assert.deepEqual(response.value, expected);
  assert.deepEqual(await persistedArtifact(course, artifact.id), expected);
  const unsupported = await request(nodeUrl(course.id, artifact.id, '主题 / 1'), { userText: '补充' }, 'POST');
  assert.equal(unsupported.status, 405);
});

test('editing refuses a symlinked artifact file and does not alter its target', async () => {
  const { course, artifact } = await fixture();
  const { outputsDir } = await store.getCoursePaths(course.id);
  const artifactPath = join(outputsDir, `result-${encodeURIComponent(artifact.id)}.json`);
  const target = join(storageHome, `outside-output-${randomUUID()}.json`);
  const original = `${JSON.stringify(artifact)}\n`;
  await writeFile(target, original);
  await rm(artifactPath);
  await symlink(target, artifactPath);
  await assert.rejects(store.updateMindmapNode(course.id, artifact.id, 'root', { userText: '不应写入' }), expectStatus(400));
  assert.equal(await readFile(target, 'utf8'), original);
});

test('invalid original-label provenance is rejected without rewriting the stored artifact', async () => {
  const { course, artifact } = await fixture();
  const { outputsDir } = await store.getCoursePaths(course.id);
  const artifactPath = join(outputsDir, `result-${encodeURIComponent(artifact.id)}.json`);
  const malformed = structuredClone(artifact);
  node(malformed).originalLabel = 42;
  await assert.rejects(store.saveArtifact(course.id, malformed), expectStatus(400));
  assert.deepEqual(await persistedArtifact(course), artifact);

  // Also defend against a malformed artifact written directly by an external producer.
  const content = `${JSON.stringify(malformed)}\n`;
  await writeFile(artifactPath, content);
  await assert.rejects(store.updateMindmapNode(course.id, artifact.id, 'root', { userText: '补充' }), expectStatus(400));
  assert.equal(await readFile(artifactPath, 'utf8'), content);
});

test('same-ID regeneration preserves original node labels and user additions captured before model writes', async () => {
  const { course, artifact } = await fixture();
  const original = await store.updateMindmapNode(course.id, artifact.id, 'root', { userText: '我的 **学习补充**\n' });
  const save = await createSaver(course.id, { skillId: 'mindmap', scope: 'page', page: 8 });
  const replacement = structuredClone(original);
  replacement.title = '重新生成的结构';
  node(replacement).label = '模型试图替换原文';
  node(replacement).userText = '模型试图替换我的补充';
  node(replacement, 'child').label = '模型试图替换子主题';
  replacement.nodes.pop(); // A node without user additions may be removed during regeneration.
  replacement.nodes.push({ id: 'new-node', label: '新增知识点', userText: '', page: 19 });
  replacement.edges[1].target = 'new-node';
  const { outputsDir } = await store.getCoursePaths(course.id);
  const artifactPath = join(outputsDir, `result-${encodeURIComponent(artifact.id)}.json`);
  await writeFile(artifactPath, JSON.stringify(replacement));

  const saved = await save(replacement);
  assert.equal(saved.title, replacement.title);
  for (const id of ['root', 'child']) {
    assert.equal(node(saved, id).label, node(original, id).label);
    assert.equal(node(saved, id).userText, node(original, id).userText);
    assert.equal(Object.hasOwn(node(saved, id), 'originalLabel'), false);
  }
  assert.deepEqual(node(saved, 'new-node'), node(replacement, 'new-node'));
  assert.deepEqual(saved.edges, replacement.edges);
  assert.deepEqual(JSON.parse(await readFile(artifactPath, 'utf8')), saved);
  assert.deepEqual(await persistedArtifact(course), saved);
});

test('regeneration that omits a node with user additions returns 409 and restores the pre-generation artifact', async () => {
  const { course, artifact } = await fixture();
  const original = await store.updateMindmapNode(course.id, artifact.id, 'root', { userText: '必须保留的补充' });
  const save = await createSaver(course.id, { skillId: 'mindmap', scope: 'book', page: 8 });
  const replacement = structuredClone(original);
  replacement.nodes = replacement.nodes.filter(item => item.id !== 'root');
  replacement.edges = replacement.edges.filter(edge => edge.source !== 'root' && edge.target !== 'root');
  const { outputsDir } = await store.getCoursePaths(course.id);
  const artifactPath = join(outputsDir, `result-${encodeURIComponent(artifact.id)}.json`);
  await writeFile(artifactPath, JSON.stringify(replacement));
  await assert.rejects(save(replacement), expectStatus(409));
  assert.deepEqual(JSON.parse(await readFile(artifactPath, 'utf8')), original);
  assert.deepEqual(await persistedArtifact(course), original);

  const saveNew = await createSaver(course.id, { skillId: 'mindmap', scope: 'book', page: 8 });
  const separate = { ...replacement, id: 'separate-new-map' };
  const savedNew = await saveNew(separate);
  assert.deepEqual(savedNew.nodes, separate.nodes, 'a new artifact ID can have its own independent structure');
  assert.deepEqual(await persistedArtifact(course), original);
  assert.deepEqual(await persistedArtifact(course, separate.id), savedNew);
});

test('legacy edited labels restore original text, migrate only additions, and cannot be resurrected by stale history', async () => {
  const { course, artifact } = await fixture();
  const originalLabel = '$\\ell_1$-正则逻辑回归';
  const legacy = structuredClone(artifact);
  Object.assign(node(legacy), { originalLabel, label: '$\\ell_1$-正则逻辑1' });
  Object.assign(node(legacy, 'child'), { originalLabel: '甲乙丙丁', label: '头甲中乙丙末丁尾' });
  Object.assign(node(legacy, 'leaf'), { originalLabel: '完整原文', label: '' });
  for (const item of legacy.nodes) delete item.userText;
  const stale = {
    page: 8, bookmarks: [], notes: [], conversationId: 'legacy-current', artifacts: [legacy],
    messages: [{ id: 'legacy-answer', role: 'assistant', content: '旧导图', artifacts: [legacy] }],
  };
  await store.saveState(course.id, { ...structuredClone(stale), artifacts: [], messages: [] });
  const { outputsDir, courseDir } = await store.getCoursePaths(course.id);
  const artifactPath = join(outputsDir, `result-${encodeURIComponent(artifact.id)}.json`);
  await writeFile(artifactPath, JSON.stringify(legacy));
  for (const id of ['legacy-current', 'legacy-history']) {
    await writeFile(join(courseDir, 'conversations', `${id}.json`), JSON.stringify({ id, messages: stale.messages }));
  }

  const expected = structuredClone(legacy);
  Object.assign(node(expected), { label: originalLabel, userText: '1' });
  Object.assign(node(expected, 'child'), { label: '甲乙丙丁', userText: '头中末尾' });
  Object.assign(node(expected, 'leaf'), { label: '完整原文', userText: '' });
  const migrated = await store.getState(course.id);
  assert.deepEqual(migrated.artifacts, [expected]);
  assert.deepEqual(migrated.messages[0].artifacts, [expected]);
  for (const id of ['legacy-current', 'legacy-history']) {
    assert.deepEqual((await store.getConversation(course.id, id)).messages[0].artifacts, [expected]);
  }

  const cleared = await store.updateMindmapNode(course.id, artifact.id, 'root', { userText: '' });
  assert.equal(node(cleared).label, originalLabel);
  assert.equal(node(cleared).userText, '');
  assert.equal(node(cleared).originalLabel, originalLabel, 'valid legacy provenance remains available');
  const saved = await store.saveState(course.id, structuredClone(stale));
  assert.deepEqual(saved.artifacts, [cleared]);
  assert.deepEqual(saved.messages[0].artifacts, [cleared]);
  const disk = JSON.parse(await readFile(artifactPath, 'utf8'));
  assert.deepEqual(disk, cleared);
  assert.equal(node(disk).label, originalLabel, 'the old replacement label is never written back');
  assert.equal(node(disk).userText, '', 'cleared additions are not recovered again from a stale label');
});

test('legacy explicit user text takes precedence, including cleared and over-2000-character historical additions', async () => {
  const { course, artifact } = await fixture();
  const { outputsDir } = await store.getCoursePaths(course.id);
  const artifactPath = join(outputsDir, `result-${encodeURIComponent(artifact.id)}.json`);
  for (const userText of ['', '\n  **我的补充**\n', '补'.repeat(2500)]) {
    const legacy = structuredClone(artifact);
    Object.assign(node(legacy), { originalLabel: '原始正文', label: '旧的修改正文', userText });
    await writeFile(artifactPath, JSON.stringify(legacy));
    const migrated = await persistedArtifact(course);
    assert.equal(node(migrated).label, '原始正文');
    assert.equal(node(migrated).userText, userText);
    const saved = await store.saveArtifact(course.id, legacy);
    assert.equal(node(saved).label, '原始正文');
    assert.equal(node(saved).userText, userText, 'the PATCH limit does not truncate existing historical additions');
    assert.deepEqual(JSON.parse(await readFile(artifactPath, 'utf8')), saved);
  }
});

test('same-ID regeneration preserves migrated legacy additions without writing back the old replacement label', async () => {
  const { course, artifact } = await fixture();
  const legacy = structuredClone(artifact);
  const originalLabel = '原始主题';
  Object.assign(node(legacy), { originalLabel, label: `${originalLabel}我的补充` });
  delete node(legacy).userText;
  const { outputsDir } = await store.getCoursePaths(course.id);
  const artifactPath = join(outputsDir, `result-${encodeURIComponent(artifact.id)}.json`);
  await writeFile(artifactPath, JSON.stringify(legacy));
  const save = await createSaver(course.id, { skillId: 'mindmap', scope: 'page', page: 8 });
  const replacement = structuredClone(legacy);
  Object.assign(node(replacement), { label: '模型替换正文', userText: '模型替换补充' });
  await writeFile(artifactPath, JSON.stringify(replacement));
  const saved = await save(replacement);
  assert.equal(node(saved).label, originalLabel);
  assert.equal(node(saved).userText, '我的补充');
  assert.equal(node(saved).originalLabel, originalLabel);
  assert.deepEqual(JSON.parse(await readFile(artifactPath, 'utf8')), saved);
});

test('new artifact IDs treat all model labels as original text and ignore forged user-text provenance', async () => {
  const { course } = await fixture();
  const save = await createSaver(course.id, { skillId: 'mindmap', scope: 'page', page: 8 });
  const generated = mindmap('mindmap', 'entirely-new-map');
  Object.assign(node(generated), { label: '模型生成的完整正文', userText: '模型伪造的用户补充', originalLabel: '模型伪造的旧原文' });
  const saved = await save(generated);
  assert.equal(node(saved).label, generated.nodes[0].label);
  assert.equal(node(saved).userText, '');
  assert.equal(Object.hasOwn(node(saved), 'originalLabel'), false);
  assert.deepEqual(await persistedArtifact(course, generated.id), saved);
});

test('user additions and explicit clearing during generation survive model overwrites before and after PATCH', async () => {
  for (const userText of ['生成期间保存的新补充', '']) {
    const { course, artifact } = await fixture();
    const original = await store.updateMindmapNode(course.id, artifact.id, 'root', { userText: '生成前的旧补充' });
    const save = await createSaver(course.id, { skillId: 'mindmap', scope: 'page', page: 8 });
    const replacement = structuredClone(original);
    Object.assign(node(replacement), { label: '模型的临时替换正文', userText: '模型的临时伪造补充' });
    const { outputsDir } = await store.getCoursePaths(course.id);
    const artifactPath = join(outputsDir, `result-${encodeURIComponent(artifact.id)}.json`);
    await writeFile(artifactPath, JSON.stringify(replacement));
    const patched = await store.updateMindmapNode(course.id, artifact.id, 'root', { userText });
    assert.equal(node(patched).label, node(original).label, 'PATCH reads the protected original during model writes');
    assert.equal(node(patched).userText, userText);
    await writeFile(artifactPath, JSON.stringify(replacement));
    const saved = await save(replacement);
    assert.equal(node(saved).label, node(original).label);
    assert.equal(node(saved).userText, userText, 'the generation snapshot follows the latest user edit or clear');
    assert.deepEqual(await persistedArtifact(course), saved);
    assert.deepEqual(JSON.parse(await readFile(artifactPath, 'utf8')), saved);
  }
});
