// Synthetic validation data: pages and evidence below are not verified textbook sources.
export function knowledgeGraph(id = 'graph-v2', extra = {}) {
  return {
    id, title: '分类模型 · 知识图谱', kind: 'knowledge-graph', schemaVersion: 2,
    detailLevel: 'overview',
    coverage: { summary: '概览分类模型与任务，未展开模型推导。', items: [
      { title: '分类模型', pages: [10, 11], status: 'covered', note: '包含模型、任务与主要联系。' },
      { title: '推导过程', pages: [12], status: 'omitted', note: '概览保留结论，有意省略推导。' },
    ] },
    nodes: [
      { id: 'model', conceptKey: 'ml.svm', type: '模型', label: '支持向量机', aliases: ['SVM', '支撑向量机'], page: 10 },
      { id: 'task', conceptKey: 'ml.binary-classification', type: '任务', label: '二元分类', page: 11 },
    ],
    edges: [{ id: 'classifies', source: 'model', target: 'task', label: '用于解决', basis: 'textbook',
      conditions: '本例的任务具有两个类别。', evidence: [{ page: 11, location: '分类模型段落', summary: '教材将支持向量机介绍为二元分类模型。' }] }],
    ...extra,
  };
}
