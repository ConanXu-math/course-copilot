import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutNetworkEdges } from '../src/lib/knowledge-network-edges.ts';
import type { NetworkLayoutNode, NetworkEdge } from '../src/lib/knowledge-network-layout.ts';

const node = (id: string, x: number, y: number): NetworkLayoutNode => ({ id, label: id, displayLabel: id, x, y, radius: 14, degree: 2, group: 'g' });
const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2;

test('parallel predicates share a directed arrow but keep every full relation and source index', () => {
  const nodes = [node('a', 0, 0), node('b', 240, 0), node('c', 0, 200)];
  const edges: NetworkEdge[] = [
    { source: 'a', target: 'b', label: '属于' },
    { source: 'a', target: 'b', label: '可以在附加条件下推广到', basis: 'inference' },
    { source: 'b', target: 'a', label: '包含' },
    { source: 'b', target: 'c', label: '关联' },
    { source: 'missing', target: 'a', label: '无效' },
  ];
  const original = structuredClone({ nodes, edges });
  const groups = layoutNetworkEdges(nodes, edges, 'a');
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0].edges.map(item => item.index), [0, 1]);
  assert.deepEqual(groups[0].label?.rows.map(row => row.lines.join('')), ['属于', '推断 · 可以在附加条件下推广到']);
  assert.equal(groups[1].source.id, 'b');
  assert.equal(groups[1].target.id, 'a');
  assert.notEqual(groups[1].path, groups[0].path);
  assert.ok(groups[0].label && groups[1].label && !overlap(groups[0].label, groups[1].label));
  assert.equal(groups[2].label, undefined, 'unrelated edges have no label');
  assert.deepEqual({ nodes, edges }, original, 'inputs stay untouched');
});

test('long Chinese predicates wrap without truncating characters and rows fit the label', () => {
  const label = '在满足可微性和适当约束资格条件的情况下可借助对偶方法求解此类最优化问题';
  const [group] = layoutNetworkEdges([node('a', 0, 0), node('b', 150, 0)], [{ source: 'a', target: 'b', label }], 'a');
  const box = group.label!;
  assert.equal(box.rows[0].lines.join(''), label);
  assert.ok(box.rows[0].lines.length >= 3);
  assert.ok(box.width <= 152);
  assert.ok(box.rows[0].y >= -box.height / 2);
  assert.ok(box.rows[0].y + (box.rows[0].lines.length - 1) * 15 < box.height / 2);
});

test('selected labels avoid short-link endpoints and an obstructing neighboring concept', () => {
  const nodes = [node('a', 0, 0), node('b', 55, 0), node('blocker', 28, -50)];
  const [group] = layoutNetworkEdges(nodes, [{ source: 'a', target: 'b', label: '用于建立较复杂的数学模型' }, { source: 'blocker', target: 'a', label: '约束' }], 'a');
  assert.ok(group.label);
  for (const current of nodes) {
    assert.ok(!overlap(group.label, { x: current.x, y: current.y, width: current.radius * 2, height: current.radius * 2 }), `${current.id} circle remains uncovered`);
    assert.ok(!overlap(group.label, { x: current.x, y: current.y + current.radius + 13, width: 50, height: 18 }), `${current.id} name remains uncovered`);
  }
});

test('faded unrelated concepts do not send a selected relation away from its local cluster', () => {
  const nodes = [node('a', 0, 0), node('b', 55, 0)];
  const edges = [{ source: 'a', target: 'b', label: '用于建立较复杂的数学模型' }];
  const [before] = layoutNetworkEdges(nodes, edges, 'a');
  const [after] = layoutNetworkEdges([...nodes, node('unrelated', before.label!.x, before.label!.y)], edges, 'a');
  assert.deepEqual(after.label, before.label);
  assert.equal(after.path, before.path);
});

test('dragging endpoints recomputes labels and leaves directed endpoints on their own nodes', () => {
  const nodes = [node('a', 0, 0), node('b', 250, 0)];
  const edges = [{ source: 'a', target: 'b', label: '依赖' }];
  const [before] = layoutNetworkEdges(nodes, edges, 'a');
  const moved = [nodes[0], { ...nodes[1], x: -120, y: 170 }];
  const [after] = layoutNetworkEdges(moved, edges, 'a');
  assert.notDeepEqual(after.label, before.label);
  assert.notEqual(after.path, before.path);
  const coordinates = after.path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)!.map(Number);
  const [startX, startY] = coordinates;
  const [endX, endY] = coordinates.slice(-2);
  assert.ok(Math.abs(Math.hypot(startX - moved[0].x, startY - moved[0].y) - (moved[0].radius + 2)) < 1e-8);
  assert.ok(Math.abs(Math.hypot(endX - moved[1].x, endY - moved[1].y) - (moved[1].radius + 3)) < 1e-8);
});

test('legacy self links and coincident endpoints produce stable finite curves and readable labels', () => {
  const nodes = [node('a', 5, 7), node('b', 5, 7)];
  const edges = [{ source: 'a', target: 'a' }, { source: 'a', target: 'b', label: '重合点联系' }];
  const groups = layoutNetworkEdges(nodes, edges, 'a');
  assert.deepEqual(layoutNetworkEdges(nodes, edges, 'a'), groups);
  for (const group of groups) {
    assert.match(group.path, /^M .+ C /);
    assert.doesNotMatch(group.path, /NaN|Infinity/);
    assert.ok(group.label && [group.label.x, group.label.y, group.label.width, group.label.height].every(Number.isFinite));
  }
  assert.equal(groups[0].label?.rows[0].lines.join(''), '未标注关系');
});

test('clearing selection removes every relation label without dropping arrows', () => {
  const nodes = [node('a', 0, 0), node('b', 200, 0)];
  const edges = [{ source: 'a', target: 'b', label: '支持' }];
  const groups = layoutNetworkEdges(nodes, edges, null);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, undefined);
  assert.ok(groups[0].path);
});

test('mask bounds contain quadratic and cubic control hulls plus arrow clearance', () => {
  const nodes = [node('a', -20, 35), node('b', 15, 45)];
  const edges = [
    { source: 'a', target: 'b', label: '用于建立较复杂的数学模型并推导相应的理论结论' },
    { source: 'b', target: 'a', label: '反馈' },
    { source: 'a', target: 'a', label: '自我检验' },
  ];
  for (const selected of [null, 'a']) {
    const groups = layoutNetworkEdges(nodes, edges, selected);
    assert.ok(groups.some(group => group.path.includes(' Q ')));
    assert.ok(groups.some(group => group.path.includes(' C ')));
    for (const { path, bounds } of groups) {
      const coordinates = path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)!.map(Number);
      for (let index = 0; index < coordinates.length; index += 2) {
        const x = coordinates[index], y = coordinates[index + 1];
        assert.ok(x >= bounds.x + 16 - 1e-8 && x <= bounds.x + bounds.width - 16 + 1e-8, 'curve endpoint or control point has horizontal clearance');
        assert.ok(y >= bounds.y + 16 - 1e-8 && y <= bounds.y + bounds.height - 16 + 1e-8, 'curve endpoint or control point has vertical clearance');
      }
    }
  }
});

test('horizontal, vertical and coincident links have finite nonzero mask regions before and after selection', () => {
  for (const [x, y] of [[240, 0], [0, 240], [0, 0]]) {
    for (const selected of [null, 'a']) {
      const [group] = layoutNetworkEdges([node('a', 0, 0), node('b', x, y)], [{ source: 'a', target: 'b', label: '联系' }], selected);
      assert.ok(Object.values(group.bounds).every(Number.isFinite));
      assert.ok(group.bounds.width >= 32 && group.bounds.height >= 32);
    }
  }
});
