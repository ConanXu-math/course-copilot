import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutKnowledgeNetwork, shortenNetworkLabel } from '../src/lib/knowledge-network-layout.ts';

type Node = { id: string; label: string; page?: number };
type Edge = { source: string; target: string; label?: string };

const EPSILON = 1e-4;

function assertLayout(nodes: Node[], edges: Edge[]) {
  const originalNodes = structuredClone(nodes);
  const originalEdges = structuredClone(edges);
  const result = layoutKnowledgeNetwork(nodes, edges);
  const inputIds = new Set(nodes.map(node => node.id));
  const validEdges = edges.filter(edge => inputIds.has(edge.source) && inputIds.has(edge.target));

  assert.deepEqual(nodes, originalNodes, 'input nodes are not mutated');
  assert.deepEqual(edges, originalEdges, 'input relationships are not mutated');
  assert.deepEqual(result.nodes.map(node => node.id).sort(), [...inputIds].sort(), 'each input node occurs exactly once');
  assert.deepEqual(result.edges, validEdges, 'every valid relationship is retained once, in its original order');
  assert.equal(new Set(result.groups.map(group => group.id)).size, result.groups.length, 'group IDs are unique');
  const groupIds = new Set(result.groups.map(group => group.id));
  for (const group of result.groups) {
    assert.equal(typeof group.label, 'string');
    assert.ok(group.label.trim(), 'groups have a display label');
    assert.equal(typeof group.color, 'string');
    assert.ok(group.color.trim(), 'groups have a display color');
  }

  const { x, y, width, height } = result.bounds;
  assert.ok([x, y, width, height].every(Number.isFinite), 'bounds contain finite values');
  assert.ok(width >= 0 && height >= 0, 'bounds have nonnegative dimensions');
  for (const node of result.nodes) {
    const original = nodes.find(item => item.id === node.id)!;
    assert.equal(node.label, original.label, `${node.id}: original label is preserved`);
    assert.equal(node.page, original.page, `${node.id}: source page is preserved`);
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y), `${node.id}: finite center`);
    assert.ok(Number.isFinite(node.radius) && node.radius > 0, `${node.id}: positive finite radius`);
    assert.ok(Number.isInteger(node.degree) && node.degree >= 0, `${node.id}: nonnegative integer degree`);
    assert.ok(groupIds.has(node.group), `${node.id}: assigned group exists`);
    assert.equal(typeof node.displayLabel, 'string');
    assert.ok(node.displayLabel.trim(), `${node.id}: visible label is not empty`);
    assert.ok(node.x - node.radius >= x - EPSILON, `${node.id}: left edge is inside bounds`);
    assert.ok(node.y - node.radius >= y - EPSILON, `${node.id}: top edge is inside bounds`);
    assert.ok(node.x + node.radius <= x + width + EPSILON, `${node.id}: right edge is inside bounds`);
    assert.ok(node.y + node.radius <= y + height + EPSILON, `${node.id}: bottom edge is inside bounds`);

    const neighbors = new Set<string>();
    for (const edge of validEdges) {
      if (edge.source === node.id && edge.target !== node.id) neighbors.add(edge.target);
      if (edge.target === node.id && edge.source !== node.id) neighbors.add(edge.source);
    }
    assert.equal(node.degree, neighbors.size, `${node.id}: degree counts distinct other neighbors`);
  }
  for (let first = 0; first < result.nodes.length; first++) {
    for (let second = first + 1; second < result.nodes.length; second++) {
      const a = result.nodes[first], b = result.nodes[second];
      const separation = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(separation + EPSILON >= a.radius + b.radius, `${a.id} and ${b.id}: circles do not overlap`);
    }
  }
  return result;
}

test('the same graph produces exactly the same layout without mutating input data', () => {
  const nodes: Node[] = [
    { id: 'optimization', label: '**最优化方法**', page: 7 },
    { id: 'gradient', label: '梯度下降', page: 23 },
    { id: 'constraint', label: '约束条件', page: 31 },
    { id: 'application', label: '模型训练', page: 46 },
  ];
  const edges: Edge[] = [
    { source: 'optimization', target: 'gradient', label: '包含方法' },
    { source: 'optimization', target: 'constraint', label: '受限于' },
    { source: 'gradient', target: 'application', label: '应用于' },
  ];
  const first = assertLayout(nodes, edges);
  const second = assertLayout(structuredClone(nodes), structuredClone(edges));
  assert.deepEqual(second, first);
});

test('valid parallel, reverse and self relationships remain intact while missing endpoints are filtered', () => {
  const nodes: Node[] = [
    { id: 'a', label: '甲' }, { id: 'b', label: '乙' }, { id: 'c', label: '丙' }, { id: 'd', label: '孤立点' },
  ];
  const result = assertLayout(nodes, [
    { source: 'a', target: 'b', label: '支持' },
    { source: 'a', target: 'b', label: '依赖' },
    { source: 'a', target: 'b', label: '依赖' },
    { source: 'b', target: 'a', label: '反馈' },
    { source: 'c', target: 'a', label: '关联' },
    { source: 'a', target: 'a', label: '递归' },
    { source: 'missing', target: 'a', label: '无效来源' },
    { source: 'a', target: 'missing', label: '无效目标' },
  ]);
  assert.equal(result.edges.length, 6);
  assert.deepEqual(Object.fromEntries(result.nodes.map(node => [node.id, node.degree])), { a: 2, b: 1, c: 1, d: 0 });
});

test('an empty graph has no nodes, relationships or groups and usable empty bounds', () => {
  const result = assertLayout([], [{ source: 'missing-a', target: 'missing-b' }]);
  assert.deepEqual(result.nodes, []);
  assert.deepEqual(result.edges, []);
  assert.deepEqual(result.groups, []);
});

test('a single node and its self relationship remain visible with degree zero', () => {
  const result = assertLayout([{ id: 'single', label: '唯一知识点', page: 1 }], [
    { source: 'single', target: 'single', label: '自我检验' },
  ]);
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].degree, 0);
  assert.equal(result.edges.length, 1);
});

test('isolated nodes are all retained, separated and assigned to display groups', () => {
  const result = assertLayout(Array.from({ length: 12 }, (_, index) => ({
    id: `isolated-${index}`, label: `独立概念 ${index + 1}`,
  })), []);
  assert.equal(result.nodes.length, 12);
  assert.ok(result.nodes.every(node => node.degree === 0));
});

test('a directed cycle needs no root and keeps all of its relationships', () => {
  const nodes = Array.from({ length: 7 }, (_, index) => ({ id: `cycle-${index}`, label: `循环概念 ${index + 1}` }));
  const edges = nodes.map((node, index) => ({ source: node.id, target: nodes[(index + 1) % nodes.length].id, label: '影响' }));
  const result = assertLayout(nodes, edges);
  assert.ok(result.nodes.every(node => node.degree === 2));
  assert.equal(result.edges.length, 7);
});

test('two dense communities joined by one bridge receive different graph groups', () => {
  const first = Array.from({ length: 6 }, (_, index) => ({ id: `a-${index}`, label: `概念 ${index + 1}` }));
  const second = Array.from({ length: 6 }, (_, index) => ({ id: `b-${index}`, label: `概念 ${index + 7}` }));
  const edges: Edge[] = [];
  for (const community of [first, second]) {
    for (let source = 0; source < community.length; source++) {
      for (let target = source + 1; target < community.length; target++) {
        edges.push({ source: community[source].id, target: community[target].id, label: '相联系' });
      }
    }
  }
  edges.push({ source: first[0].id, target: second[0].id, label: '桥接' });
  const result = assertLayout([...first, ...second], edges);
  const firstGroups = new Set(result.nodes.filter(node => node.id.startsWith('a-')).map(node => node.group));
  const secondGroups = new Set(result.nodes.filter(node => node.id.startsWith('b-')).map(node => node.group));
  assert.equal(firstGroups.size, 1, 'the first dense community stays together');
  assert.equal(secondGroups.size, 1, 'the second dense community stays together');
  assert.notEqual([...firstGroups][0], [...secondGroups][0], 'the single bridge does not merge the dense communities');

  const renamed = assertLayout([...first, ...second].map(node => ({ ...node, label: '同一个无关名称' })), edges);
  const partition = (layout: typeof result) => [...new Set(layout.nodes.map(node => node.group))]
    .map(group => layout.nodes.filter(node => node.group === group).map(node => node.id).sort())
    .sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(partition(renamed), partition(result), 'group membership depends on graph connections, not textbook wording');
});

test('short names are readable plain text and layout preserves the full original labels', () => {
  const labels = [
    '**梯度下降**',
    '[强化学习](https://example.com/rl)',
    '<b>矩阵分解</b>',
    '# 目标函数\n`最小化`',
    '带 $\\ell_2$ 正则化的最优化问题',
    '$\\alpha + \\beta$',
  ];
  const result = assertLayout(labels.map((label, index) => ({ id: `label-${index}`, label, page: index + 1 })), []);
  for (let index = 0; index < labels.length; index++) {
    const original = labels[index];
    const shortened = shortenNetworkLabel(original);
    assert.ok(shortened.trim(), `label ${index}: shortened name is not empty`);
    assert.doesNotMatch(shortened, /[\\{}$*`#\r\n]|<[^>]*>|https?:\/\/|\]\(/, `label ${index}: no raw markup or formula delimiters`);
    assert.ok([...shortened].length <= 12, `label ${index}: default visible length is at most 12 characters`);
    const node = result.nodes.find(item => item.id === `label-${index}`)!;
    assert.equal(node.label, original);
    assert.equal(node.displayLabel, shortened);
  }
  assert.equal(shortenNetworkLabel('**梯度下降**'), '梯度下降');
  assert.equal(shortenNetworkLabel('[强化学习](https://example.com/rl)'), '强化学习');
  assert.equal(shortenNetworkLabel('<b>矩阵分解</b>'), '矩阵分解');
});

test('name shortening honors a custom maximum while leaving short plain names unchanged', () => {
  assert.equal(shortenNetworkLabel('凸优化'), '凸优化');
  const long = '这是一段用于验证节点名称长度限制的说明';
  const shortened = shortenNetworkLabel(long, 6);
  assert.ok([...shortened].length > 0 && [...shortened].length <= 6);
  assert.notEqual(shortened, long);
  assert.ok([...shortenNetworkLabel(long)].length <= 12);
});

test('a 200-node network lays out without overlaps or dropped relationships', { timeout: 3000 }, context => {
  const nodes = Array.from({ length: 200 }, (_, index) => ({ id: `node-${index}`, label: `知识节点 ${index + 1}` }));
  const edges: Edge[] = [];
  for (let index = 0; index < nodes.length; index++) {
    for (const offset of [1, 3, 7]) {
      edges.push({ source: nodes[index].id, target: nodes[(index + offset) % nodes.length].id, label: '关联' });
    }
  }
  const start = performance.now();
  const result = assertLayout(nodes, edges);
  context.diagnostic(`200 nodes / 600 relationships, layout plus contract checks: ${(performance.now() - start).toFixed(1)} ms`);
  assert.equal(result.nodes.length, 200);
  assert.equal(result.edges.length, 600);
});

test('a 200-node star with long Chinese labels separates every leaf from the hub and its neighbors', { timeout: 3000 }, context => {
  const nodes = Array.from({ length: 200 }, (_, index) => ({
    id: index === 0 ? 'hub' : `leaf-${index}`,
    label: index === 0
      ? '机器学习与最优化理论之间的重要知识关联中心'
      : `第${index}个关于机器学习最优化理论及实际应用的详细知识概念`,
    page: index + 1,
  }));
  const edges = nodes.slice(1).map(node => ({ source: 'hub', target: node.id, label: '联系到详细概念' }));
  const start = performance.now();
  const result = assertLayout(nodes, edges);
  context.diagnostic(`200-node star / 199 relationships, layout plus contract checks: ${(performance.now() - start).toFixed(1)} ms`);
  assert.equal(result.nodes.length, 200);
  assert.equal(result.edges.length, 199);
  assert.equal(result.nodes.find(node => node.id === 'hub')!.degree, 199);
  assert.ok(result.nodes.filter(node => node.id !== 'hub').every(node => node.degree === 1));
  assert.ok(result.nodes.every(node => [...node.displayLabel].length <= 12), 'long Chinese labels respect the visible length limit');
});
