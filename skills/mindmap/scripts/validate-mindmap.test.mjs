import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateMindmap } from './validate-mindmap.mjs';

function tree() {
  return {
    id: 'result-1', kind: 'mindmap', title: '教材概念',
    nodes: [{ id: 'root', label: '概念', page: 1 }, { id: 'a', label: '定义', page: 2 }, { id: 'b', label: '应用', page: 10 }],
    edges: [{ source: 'root', target: 'a' }, { source: 'root', target: 'b', label: '用于' }],
  };
}

test('accepts a rooted tree and preserves its input', () => {
  const result = tree();
  const before = structuredClone(result);
  assert.deepEqual(validateMindmap(result, 'result-1', 10), { rootId: 'root', nodeCount: 3, edgeCount: 2 });
  assert.deepEqual(result, before);
});

test('accepts a single root without a page citation', () => {
  const result = tree();
  result.nodes = [{ id: 'root', label: '概念' }];
  result.edges = [];
  assert.equal(validateMindmap(result, 'result-1', 10).rootId, 'root');
});

const invalidCases = [
  ['wrong artifact kind', result => { result.kind = 'knowledge-graph'; }, /kind/],
  ['mismatched result ID', result => { result.id = 'another-result'; }, /ID 不一致/],
  ['empty title', result => { result.title = ' '; }, /title/],
  ['empty nodes', result => { result.nodes = []; }, /nodes/],
  ['duplicate node IDs', result => { result.nodes.push({ id: 'a', label: '重复' }); }, /ID 重复/],
  ['blank node labels', result => { result.nodes[1].label = ''; }, /label/],
  ['dangling edges', result => { result.edges[0].target = 'missing'; }, /已有节点/],
  ['duplicate edges', result => { result.edges.push({ ...result.edges[0] }); }, /连线重复/],
  ['self edges', result => { result.edges[0].target = 'root'; }, /自身/],
  ['a disconnected cycle', result => { result.edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }]; }, /有向环/],
  ['a cycle without any root', result => { result.edges.push({ source: 'a', target: 'root' }); }, /有向环/],
  ['disconnected trees', result => { result.edges = [result.edges[0]]; }, /全连通/],
  ['multiple parents', result => { result.edges.push({ source: 'a', target: 'b' }); }, /一个父节点/],
  ['zero page', result => { result.nodes[0].page = 0; }, /page/],
  ['page beyond textbook', result => { result.nodes[1].page = 11; }, /page/],
  ['fractional page', result => { result.nodes[1].page = 1.5; }, /page/],
  ['string page', result => { result.nodes[1].page = '2'; }, /page/],
  ['null page', result => { result.nodes[1].page = null; }, /page/],
];

for (const [name, mutate, expectedError] of invalidCases) {
  test(`rejects ${name}`, () => {
    const result = tree();
    mutate(result);
    assert.throws(() => validateMindmap(result, 'result-1', 10), expectedError);
  });
}

test('rejects invalid validation context', () => {
  assert.throws(() => validateMindmap(tree(), '', 10), /ID 不能为空/);
  for (const totalPages of [0, -1, 1.5, NaN, Infinity, '10']) {
    assert.throws(() => validateMindmap(tree(), 'result-1', totalPages), /总页数/);
  }
});

test('CLI reads a result and returns a nonzero status for malformed or mismatched results', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'course-mindmap-validation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const resultPath = join(directory, 'result.json');
  const script = fileURLToPath(new URL('./validate-mindmap.mjs', import.meta.url));
  const run = id => spawnSync(process.execPath, [script, resultPath, id, '10'], { cwd: directory, encoding: 'utf8' });
  await writeFile(resultPath, JSON.stringify(tree()));
  const success = run('result-1');
  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.stderr, '');
  assert.ok(success.stdout.trim());
  const mismatch = run('wrong-id');
  assert.equal(mismatch.status, 1);
  assert.equal(mismatch.stdout, '');
  assert.ok(mismatch.stderr.trim());
  await writeFile(resultPath, '{invalid JSON');
  const malformed = run('result-1');
  assert.equal(malformed.status, 1);
  assert.equal(malformed.stdout, '');
  assert.ok(malformed.stderr.trim());
});
