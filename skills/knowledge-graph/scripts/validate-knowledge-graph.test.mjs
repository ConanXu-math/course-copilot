import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateKnowledgeGraph } from './validate-knowledge-graph.mjs';

const script = fileURLToPath(new URL('./validate-knowledge-graph.mjs', import.meta.url));

function graph() {
  return {
    id: 'graph-1', kind: 'knowledge-graph', title: '教材知识关系',
    nodes: [
      { id: 'a', label: '凸性', page: 1 },
      { id: 'b', label: '最优性条件', page: 10 },
      { id: 'c', label: '算法收敛' },
    ],
    edges: [
      { source: 'a', target: 'b', label: '用于推导' },
      { source: 'b', target: 'c', label: '帮助分析' },
    ],
  };
}

function v2Graph() {
  const result = graph();
  return {
    ...result,
    schemaVersion: 2,
    detailLevel: 'overview',
    coverage: {
      summary: '覆盖当前节的主要概念与关系。',
      items: [{ title: '凸性与最优性', pages: [1, 10], status: 'covered', note: '保留条件，略去证明细节。' }],
    },
    nodes: result.nodes.map(node => ({ ...node, conceptKey: `optimization.${node.id}`, type: '概念' })),
    edges: result.edges.map((edge, index) => ({
      ...edge, id: `relation-${index}`, basis: 'textbook',
      evidence: [{ page: index + 1, summary: '教材根据给定条件建立两者的关系。', location: '当前节定义之后' }],
    })),
  };
}

test('validates a knowledge graph without modifying its nodes, relations, or extra fields', () => {
  const result = graph();
  result.metadata = { note: 'retain' };
  result.nodes[0].extra = { color: 'blue' };
  result.edges[0].label = '  可以用来证明\n';
  const before = structuredClone(result);
  assert.deepEqual(validateKnowledgeGraph(result, 'graph-1', 10), { nodeCount: 3, edgeCount: 2, componentCount: 1 });
  assert.deepEqual(result, before, 'trimming for validation must not rewrite the original relation label');
});

test('accepts multiple parents, directed cycles, and reverse relations in one graph', () => {
  const result = graph();
  result.edges.push(
    { source: 'a', target: 'c', label: '另一种推导路径' },
    { source: 'c', target: 'a', label: '通过反馈影响' },
    { source: 'b', target: 'a', label: '反向表征' },
  );
  assert.deepEqual(validateKnowledgeGraph(result, 'graph-1', 10), { nodeCount: 3, edgeCount: 5, componentCount: 1 });
});

test('counts weak components across inward edges, separate subnetworks, and isolated nodes', () => {
  const result = graph();
  result.nodes.push({ id: 'd', label: '独立前提' }, { id: 'e', label: '独立结论' }, { id: 'f', label: '孤立知识点' });
  result.edges = [
    { source: 'b', target: 'a', label: '指向' },
    { source: 'c', target: 'a', label: '同样指向' },
    { source: 'e', target: 'd', label: '另一个子网' },
  ];
  assert.deepEqual(validateKnowledgeGraph(result, 'graph-1', 10), { nodeCount: 6, edgeCount: 3, componentCount: 3 });
});

test('accepts a single isolated node and an edgeless graph with several components', () => {
  const result = graph();
  result.edges = [];
  assert.deepEqual(validateKnowledgeGraph(result, 'graph-1', 10), { nodeCount: 3, edgeCount: 0, componentCount: 3 });
  result.nodes = [{ id: 'only', label: '独立概念' }];
  assert.deepEqual(validateKnowledgeGraph(result, 'graph-1', 10), { nodeCount: 1, edgeCount: 0, componentCount: 1 });
});

test('different node IDs may share a label and relation words are not restricted to a vocabulary', () => {
  const result = graph();
  result.nodes[1].label = result.nodes[0].label;
  result.edges[0].label = '满足教材中特定的局部正则条件';
  result.edges[1].label = 'provides an alternate interpretation';
  assert.deepEqual(validateKnowledgeGraph(result, 'graph-1', 10), { nodeCount: 3, edgeCount: 2, componentCount: 1 });
});

test('accepts long conditional and Unicode relations without imposing a character limit', () => {
  const result = graph();
  for (const label of [
    '当目标函数满足凸性且梯度连续并且步长符合教材给定条件时，迭代点之间的关系可以进一步用于推导对应算法的收敛结论',
    '关'.repeat(41), ` \t${'🧠'.repeat(80)}\n `, 'a\u0301'.repeat(30),
  ]) {
    result.edges[0].label = label;
    assert.equal(validateKnowledgeGraph(result, 'graph-1', 10).edgeCount, 2);
    assert.equal(result.edges[0].label, label);
  }
});

test('duplicate directed pairs require merging relations even when their labels differ', () => {
  for (const label of ['用于推导', '同一对节点上的另一种关系']) {
    const result = graph();
    result.edges.push({ source: 'a', target: 'b', label });
    assert.throws(() => validateKnowledgeGraph(result, 'graph-1', 10), /合并|merge/i);
  }
});

test('node IDs containing punctuation do not cause distinct edge pairs to collide', () => {
  const result = graph();
  result.nodes = [
    { id: 'a,b', label: '甲' }, { id: 'c', label: '乙' },
    { id: 'a', label: '丙' }, { id: 'b,c', label: '丁' },
  ];
  result.edges = [
    { source: 'a,b', target: 'c', label: '第一对' },
    { source: 'a', target: 'b,c', label: '第二对' },
  ];
  assert.deepEqual(validateKnowledgeGraph(result, 'graph-1', 10), { nodeCount: 4, edgeCount: 2, componentCount: 2 });
});

const invalidCases = [
  ['wrong artifact kind', result => { result.kind = 'mindmap'; }],
  ['a mismatched artifact ID', result => { result.id = 'different-result'; }],
  ['an absent artifact ID', result => { delete result.id; }],
  ['an empty title', result => { result.title = ' \t\n '; }],
  ['a non-string title', result => { result.title = 123; }],
  ['an empty node array', result => { result.nodes = []; }],
  ['non-array nodes', result => { result.nodes = {}; }],
  ['a non-object node', result => { result.nodes[0] = null; }],
  ['a blank node ID', result => { result.nodes[0].id = ' '; }],
  ['a non-string node ID', result => { result.nodes[0].id = 1; }],
  ['a blank node label', result => { result.nodes[0].label = '\t'; }],
  ['a non-string node label', result => { result.nodes[0].label = []; }],
  ['duplicate node IDs', result => { result.nodes[1].id = result.nodes[0].id; }],
  ['missing edges', result => { delete result.edges; }],
  ['non-array edges', result => { result.edges = {}; }],
  ['a non-object edge', result => { result.edges[0] = null; }],
  ['an unknown source', result => { result.edges[0].source = 'missing'; }],
  ['an unknown target', result => { result.edges[0].target = 'missing'; }],
  ['a missing source', result => { delete result.edges[0].source; }],
  ['a non-string target', result => { result.edges[0].target = 1; }],
  ['a self relation', result => { result.edges[0].target = result.edges[0].source; }],
  ['a missing relation label', result => { delete result.edges[0].label; }],
  ['a whitespace-only relation label', result => { result.edges[0].label = ' \t\n '; }],
  ['a non-string relation label', result => { result.edges[0].label = false; }],
];

for (const [name, mutate] of invalidCases) {
  test(`rejects ${name}`, () => {
    const result = graph();
    mutate(result);
    assert.throws(() => validateKnowledgeGraph(result, 'graph-1', 10));
  });
}

test('rejects non-object result values', () => {
  for (const result of [undefined, null, [], 'graph', 123, false]) {
    assert.throws(() => validateKnowledgeGraph(result, 'graph-1', 10));
  }
});

test('optional page citations must be safe integers between 1 and the textbook page count', () => {
  for (const page of [0, -1, 11, 1.5, '1', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const result = graph();
    result.nodes[0].page = page;
    assert.throws(() => validateKnowledgeGraph(result, 'graph-1', 10));
  }
  const result = graph();
  result.nodes[0].page = undefined;
  assert.equal(validateKnowledgeGraph(result, 'graph-1', 10).nodeCount, 3);
  result.nodes[0].page = Number.MAX_SAFE_INTEGER;
  assert.equal(validateKnowledgeGraph(result, 'graph-1', Number.MAX_SAFE_INTEGER).nodeCount, 3);
});

test('rejects blank or non-string expected IDs and invalid total page counts', () => {
  for (const expectedId of ['', ' \t\n ', undefined, null, 1, ['graph-1']]) {
    assert.throws(() => validateKnowledgeGraph(graph(), expectedId, 10));
  }
  for (const totalPages of [0, -1, 1.5, NaN, Infinity, '10', undefined, null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateKnowledgeGraph(graph(), 'graph-1', totalPages));
  }
});

test('fully validates v2 with or without requireV2 and never rewrites evidence, conditions, or metadata', () => {
  const result = v2Graph();
  result.nodes[0].aliases = ['凸函数性质', 'convexity'];
  result.nodes[0].description = '在给定定义域内满足 $f(\\lambda x+(1-\\lambda)y)\\leq\\lambda f(x)+(1-\\lambda)f(y)$。';
  result.edges[0].conditions = '  函数可微，定义域为凸集。\n';
  result.edges[0].evidence.push({ page: 10, summary: '后文给出相应结论。' });
  result.source = { scope: 'section', page: 1, sectionId: 'section-1' };
  const before = structuredClone(result);
  for (const options of [undefined, {}, { requireV2: true }, { requireV2: false }]) {
    assert.deepEqual(validateKnowledgeGraph(result, 'graph-1', 10, options), { nodeCount: 3, edgeCount: 2, componentCount: 1 });
    assert.deepEqual(result, before);
  }
});

test('requireV2 rejects legacy but legacy remains readable without the option', () => {
  assert.throws(() => validateKnowledgeGraph(graph(), 'graph-1', 10, { requireV2: true }), /必须使用 schemaVersion: 2/);
  assert.equal(validateKnowledgeGraph(graph(), 'graph-1', 10, { requireV2: false }).nodeCount, 3);
  const result = v2Graph();
  delete result.edges[0].evidence;
  for (const options of [undefined, { requireV2: false }, { requireV2: true }]) {
    assert.throws(() => validateKnowledgeGraph(result, 'graph-1', 10, options), /relation-0.*evidence/);
  }
});

test('rejects unknown and mistyped explicit schema versions instead of treating them as legacy', () => {
  for (const schemaVersion of [null, 0, 1, 3, '2', false, {}, []]) {
    const result = { ...v2Graph(), schemaVersion };
    assert.throws(() => validateKnowledgeGraph(result, 'graph-1', 10), /不支持的 schemaVersion/);
  }
});

test('v2 allows multiple predicates, reverse relations, directed cycles, and an isolated concept', () => {
  const result = v2Graph();
  result.nodes.push({ id: 'isolated', label: '另一概念', conceptKey: 'optimization.isolated', type: '条件' });
  const relation = (id, source, target, label) => ({
    id, source, target, label, basis: 'textbook', evidence: [{ page: 3, summary: '正文支撑此关系。' }],
  });
  result.edges.push(
    relation('alternate', 'a', 'b', '限定适用范围'),
    relation('reverse', 'b', 'a', '用于检验'),
    relation('cycle', 'c', 'a', '进一步要求'),
  );
  assert.deepEqual(validateKnowledgeGraph(result, 'graph-1', 10, { requireV2: true }), { nodeCount: 4, edgeCount: 5, componentCount: 2 });
});

test('v2 rejects the same directed predicate after trimming but preserves meaningful punctuation', () => {
  const result = v2Graph();
  result.edges.push({ ...structuredClone(result.edges[0]), id: 'duplicate', label: ` \t${result.edges[0].label}\n` });
  assert.throws(() => validateKnowledgeGraph(result, 'graph-1', 10), /关系重复：a → b（用于推导）/);
  result.edges.at(-1).label = '用于推导（局部）';
  assert.equal(validateKnowledgeGraph(result, 'graph-1', 10).edgeCount, 3);
});

test('v2 has no fixed ontology or relation vocabulary and keeps same-name distinct concepts', () => {
  const result = v2Graph();
  result.nodes[0].type = '教材特有的数学对象';
  result.nodes[1].label = result.nodes[0].label;
  result.nodes[1].conceptKey = 'optimization.a.with-different-assumptions';
  result.nodes[0].aliases = [];
  result.nodes[0].description = '';
  result.edges[0].conditions = '';
  result.edges[0].label = '满足教材中特定的局部正则条件后用于分析';
  result.edges[0].basis = 'inference';
  result.edges[0].evidence[0].summary = '这是推断前提的正文依据，结论另行注明。';
  assert.equal(validateKnowledgeGraph(result, 'graph-1', 10).nodeCount, 3);
});

test('v2 accepts both detail modes and explicit covered, omitted, and unread coverage units', () => {
  const result = v2Graph();
  result.coverage.items.push(
    { title: '未展开的证明', pages: [2, 3], status: 'omitted', note: '概览省略证明。' },
    { title: '尚未读清的段落', pages: [4], status: 'unread', note: '扫描图像未能辨认。' },
    { title: '无法定位的附录', pages: [], status: 'unread', note: '没有可靠页码边界。' },
  );
  for (const detailLevel of ['overview', 'detailed']) {
    result.detailLevel = detailLevel;
    assert.equal(validateKnowledgeGraph(result, 'graph-1', 10).edgeCount, 2);
  }
});

const invalidV2Cases = [
  ['missing detail level', result => { delete result.detailLevel; }, /detailLevel/],
  ['unknown detail level', result => { result.detailLevel = 'complete'; }, /detailLevel/],
  ['missing coverage', result => { delete result.coverage; }, /coverage.summary/],
  ['blank coverage summary', result => { result.coverage.summary = ' \n '; }, /coverage.summary/],
  ['missing coverage items', result => { delete result.coverage.items; }, /coverage.items/],
  ['empty coverage items', result => { result.coverage.items = []; }, /coverage.items/],
  ['non-array coverage items', result => { result.coverage.items = {}; }, /coverage.items/],
  ['non-object coverage unit', result => { result.coverage.items[0] = null; }, /coverage.items\[0\].title/],
  ['blank coverage title', result => { result.coverage.items[0].title = ' '; }, /coverage.items\[0\].title/],
  ['unknown coverage status', result => { result.coverage.items[0].status = 'partial'; }, /coverage.items\[0\].status/],
  ['missing coverage note', result => { delete result.coverage.items[0].note; }, /coverage.items\[0\].note/],
  ['non-string coverage note', result => { result.coverage.items[0].note = false; }, /coverage.items\[0\].note/],
  ['missing coverage pages', result => { delete result.coverage.items[0].pages; }, /coverage.items\[0\].pages/],
  ['empty covered pages', result => { result.coverage.items[0].pages = []; }, /仅在 status 为 unread/],
  ['empty omitted pages', result => { result.coverage.items[0].status = 'omitted'; result.coverage.items[0].pages = []; }, /仅在 status 为 unread/],
  ['missing conceptKey', result => { delete result.nodes[0].conceptKey; }, /节点 a.*conceptKey/],
  ['blank conceptKey', result => { result.nodes[0].conceptKey = ' \t '; }, /节点 a.*conceptKey/],
  ['non-string conceptKey', result => { result.nodes[0].conceptKey = 12; }, /节点 a.*conceptKey/],
  ['duplicate conceptKey', result => { result.nodes[1].conceptKey = result.nodes[0].conceptKey; }, /conceptKey 重复/],
  ['missing node type', result => { delete result.nodes[0].type; }, /节点 a.*type/],
  ['blank node type', result => { result.nodes[0].type = ''; }, /节点 a.*type/],
  ['non-string node type', result => { result.nodes[0].type = {}; }, /节点 a.*type/],
  ['non-array aliases', result => { result.nodes[0].aliases = '凸性'; }, /节点 a.*aliases/],
  ['blank alias', result => { result.nodes[0].aliases = ['另名', ' ']; }, /节点 a.*aliases/],
  ['non-string alias', result => { result.nodes[0].aliases = [1]; }, /节点 a.*aliases/],
  ['non-string description', result => { result.nodes[0].description = null; }, /节点 a.*description/],
  ['missing relation ID', result => { delete result.edges[0].id; }, /连线的 id/],
  ['blank relation ID', result => { result.edges[0].id = '\t'; }, /连线的 id/],
  ['duplicate relation ID', result => { result.edges[1].id = result.edges[0].id; }, /连线 ID 重复/],
  ['missing evidence basis', result => { delete result.edges[0].basis; }, /relation-0.*basis/],
  ['unknown evidence basis', result => { result.edges[0].basis = 'probably'; }, /relation-0.*basis/],
  ['non-string conditions', result => { result.edges[0].conditions = []; }, /relation-0.*conditions/],
  ['missing evidence', result => { delete result.edges[0].evidence; }, /relation-0.*evidence/],
  ['empty evidence', result => { result.edges[0].evidence = []; }, /relation-0.*evidence/],
  ['non-array evidence', result => { result.edges[0].evidence = {}; }, /relation-0.*evidence/],
  ['non-object evidence entry', result => { result.edges[0].evidence[0] = null; }, /evidence\[0\].page/],
  ['missing evidence page', result => { delete result.edges[0].evidence[0].page; }, /evidence\[0\].page/],
  ['missing evidence summary', result => { delete result.edges[0].evidence[0].summary; }, /evidence\[0\].summary/],
  ['blank evidence summary', result => { result.edges[0].evidence[0].summary = ' \n '; }, /evidence\[0\].summary/],
  ['non-string evidence summary', result => { result.edges[0].evidence[0].summary = 12; }, /evidence\[0\].summary/],
  ['non-string evidence location', result => { result.edges[0].evidence[0].location = 12; }, /evidence\[0\].location/],
];

for (const [name, mutate, expected] of invalidV2Cases) {
  test(`v2 rejects ${name} with the failing field identified`, () => {
    const result = v2Graph();
    mutate(result);
    assert.throws(() => validateKnowledgeGraph(result, 'graph-1', 10), expected);
  });
}

test('v2 checks every evidence and coverage page against the real safe-integer page range', () => {
  for (const page of [0, -1, 11, 1.5, '1', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const evidenceResult = v2Graph();
    evidenceResult.edges[0].evidence.push({ page, summary: '第二条依据也必须核对页码。' });
    assert.throws(() => validateKnowledgeGraph(evidenceResult, 'graph-1', 10), /evidence\[1\].page/);
    const coverageResult = v2Graph();
    coverageResult.coverage.items[0].pages.push(page);
    assert.throws(() => validateKnowledgeGraph(coverageResult, 'graph-1', 10), /coverage.items\[0\].pages/);
  }
});

async function cliFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'course-knowledge-graph-validation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = 'knowledge graph.json';
  const resultPath = join(directory, filename);
  await writeFile(resultPath, JSON.stringify(graph()));
  const run = args => spawnSync(process.execPath, [script, ...args], { cwd: directory, encoding: 'utf8' });
  return { filename, resultPath, run };
}

function assertCliFailure(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.trim(), 'CLI explains why validation failed');
}

test('CLI accepts valid JSON from an unrelated working directory using an absolute script path', async t => {
  const { filename, resultPath, run } = await cliFixture(t);
  for (const path of [filename, resultPath]) {
    const success = run([path, 'graph-1', '10']);
    assert.equal(success.error, undefined);
    assert.equal(success.status, 0, success.stderr);
    assert.equal(success.stderr, '');
    assert.ok(success.stdout.trim());
  }
});

test('CLI fails for mismatched IDs, invalid graph data, malformed JSON, and missing files', async t => {
  const { resultPath, run } = await cliFixture(t);
  assertCliFailure(run([resultPath, 'wrong-id', '10']));
  const invalid = graph();
  delete invalid.edges[0].label;
  await writeFile(resultPath, JSON.stringify(invalid));
  assertCliFailure(run([resultPath, 'graph-1', '10']));
  await writeFile(resultPath, '{invalid JSON');
  assertCliFailure(run([resultPath, 'graph-1', '10']));
  assertCliFailure(run([`${resultPath}.missing`, 'graph-1', '10']));
});

test('CLI rejects missing or extra arguments and non-positive or unsafe page counts', async t => {
  const { resultPath, run } = await cliFixture(t);
  for (const args of [[], [resultPath], [resultPath, 'graph-1'], [resultPath, 'graph-1', '10', 'extra'],
    [resultPath, ' ', '10']]) {
    assertCliFailure(run(args));
  }
  for (const pages of ['0', '-1', '1.5', 'ten', 'Infinity', '9007199254740992']) {
    assertCliFailure(run([resultPath, 'graph-1', pages]));
  }
});

test('CLI accepts v2 automatically, supports --require-v2, and still rejects broken v2 without the flag', async t => {
  const { resultPath, run } = await cliFixture(t);
  const legacy = run([resultPath, 'graph-1', '10', '--require-v2']);
  assertCliFailure(legacy);
  assert.match(legacy.stderr, /必须使用 schemaVersion: 2/);
  const result = v2Graph();
  await writeFile(resultPath, JSON.stringify(result));
  for (const flags of [[], ['--require-v2']]) {
    const success = run([resultPath, 'graph-1', '10', ...flags]);
    assert.equal(success.status, 0, success.stderr);
    assert.match(success.stdout, /3 个节点，2 条连线，1 个连通分量/);
  }
  delete result.edges[0].evidence;
  await writeFile(resultPath, JSON.stringify(result));
  for (const flags of [[], ['--require-v2']]) {
    const failure = run([resultPath, 'graph-1', '10', ...flags]);
    assertCliFailure(failure);
    assert.match(failure.stderr, /relation-0.*evidence/);
  }
  assertCliFailure(run([resultPath, 'graph-1', '10', '--require-v2', '--require-v2']));
});
