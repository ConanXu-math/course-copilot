import assert from 'node:assert/strict';
import test from 'node:test';
import { canOpenKnowledgeGraphPage, matchesKnowledgeConcept } from '../src/lib/knowledge-graph-details.ts';
import { layoutKnowledgeNetwork } from '../src/lib/knowledge-network-layout.ts';

test('concept search finds aliases and descriptions without requiring the displayed short name', () => {
  const node = { id: 'svm', label: '支持向量机', aliases: ['SVM', '支撑向量机'], description: '通过分类超平面区分样本。' };
  for (const query of ['支持向量', ' svm ', 'ＳＶＭ', '支撑向量机', '分类超平面']) {
    assert.equal(matchesKnowledgeConcept(node, query), true, query);
  }
  assert.equal(matchesKnowledgeConcept(node, '随机森林'), false);
  assert.equal(matchesKnowledgeConcept({ id: 'old', label: '旧概念' }, '旧概念'), true);
  assert.equal(matchesKnowledgeConcept({ id: 'old', label: '旧概念' }, 'SVM'), false);
});

test('evidence links only open positive physical PDF pages within the known book', () => {
  for (const page of [1, 12, 202]) assert.equal(canOpenKnowledgeGraphPage(page, 202), true);
  for (const page of [0, -1, 1.5, 203, NaN, Infinity, '12', null, undefined]) {
    assert.equal(canOpenKnowledgeGraphPage(page, 202), false, String(page));
  }
  assert.equal(canOpenKnowledgeGraphPage(12), true, 'a valid legacy page remains usable when the total is unknown');
});

test('force layout retains concept metadata and each independently evidenced predicate', () => {
  const nodes = [
    { id: 'a', label: '模型甲', page: 10, conceptKey: 'course.model-a', type: '模型', aliases: ['Model A'], description: '适用范围与公式 $x^2$。' },
    { id: 'b', label: '模型族', page: 11, conceptKey: 'course.model-family', type: '概念' },
  ];
  const edges = [
    { id: 'a-b-1', source: 'a', target: 'b', label: '属于', basis: 'textbook' as const, conditions: '在条件甲成立时', evidence: [{ page: 10, summary: '支持这条关系的教材摘要。', location: '定义 1' }] },
    { id: 'a-b-2', source: 'a', target: 'b', label: '可推广到', basis: 'inference' as const, conditions: '还需假设乙', evidence: [{ page: 10, summary: '推断前提之一。' }, { page: 11, summary: '推断前提之二。' }] },
  ];
  const original = structuredClone({ nodes, edges });
  const result = layoutKnowledgeNetwork(nodes, edges);
  assert.deepEqual(result.edges, original.edges);
  assert.equal(result.nodes[0].degree, 1, 'different predicates do not invent extra neighboring concepts');
  for (const [field, value] of Object.entries(original.nodes[0])) assert.deepEqual(result.nodes[0][field], value, field);
  assert.deepEqual({ nodes, edges }, original, 'layout does not edit evidence or source metadata');
  const legacy = layoutKnowledgeNetwork([{ id: 'old', label: '旧概念' }], []);
  assert.equal(legacy.nodes[0].conceptKey, undefined, 'legacy metadata is not invented');
  assert.equal(legacy.nodes[0].description, undefined);
});
