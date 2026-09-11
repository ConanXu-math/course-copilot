import assert from 'node:assert/strict';
import test from 'node:test';
import { mindmapPlacement, sortMindmaps } from '../src/lib/artifact-order.ts';
import type { Artifact, ArtifactSource, Chapter } from '../src/lib/types.ts';

const chapters: Chapter[] = [
  { id: 'c1', title: '机器学习中的最优化问题', level: 0, page: 7 },
  { id: 's11', title: '为什么学习最优化？', level: 1, page: 8 },
  { id: 's12', title: '机器学习中的最优化问题', level: 1, page: 9 },
  { id: 's121', title: '监督学习', level: 2, page: 10 },
  { id: 's122', title: '强化学习', level: 2, page: 15 },
  { id: 's13', title: '本章小结', level: 1, page: 17 },
  { id: 'c2', title: '最优化理论', level: 0, page: 18 },
  { id: 's21', title: '最优化问题基本形式', level: 1, page: 18 },
  { id: 's22', title: '拉格朗日对偶问题', level: 1, page: 22 },
  { id: 's23', title: '本章小结', level: 1, page: 38 },
];
const book = { chapters };
function map(id: string, title: string, page?: number, source?: ArtifactSource): Extract<Artifact, { kind: 'mindmap' | 'knowledge-graph' }> {
  return { id, title, kind: 'mindmap', source, nodes: [{ id: 'root', label: title, page }], edges: [] };
}
const ids = (items: Artifact[]) => sortMindmaps(items, book).map(item => item.id);

test('book first; chapter totals before sections; section totals before excerpts', () => {
  const items = [
    map('c2-excerpt', '摘要', 23, { scope: 'selection', page: 23, chapterId: 'c2', sectionId: 's22' }),
    map('s12-excerpt', '强化学习 · 选文思维导图（PDF 第16页）', 16),
    map('c2', '第二章总图', 25, { scope: 'chapter', page: 25, chapterId: 'c2' }),
    map('s12', '1.2 机器学习中的最优化问题 · 思维导图', 9),
    map('s11', '为什么学习最优化？ · 思维导图', 8),
    map('whole', '总图', 100, { scope: 'book', page: 100 }),
    map('c1', '第一章 · 思维导图', 7),
    map('s22', '节总图', 27, { scope: 'section', page: 27, chapterId: 'c2', sectionId: 's22' }),
    map('s21', '最优化问题基本形式 · 思维导图', 18),
  ];
  assert.deepEqual(ids(items), ['whole', 'c1', 's11', 's12', 's12-excerpt', 'c2', 's21', 's22', 'c2-excerpt']);
});

test('the actual three legacy titles resolve chapter/section despite repeated names and PDF offset', () => {
  const detail = map('detail', '强化学习 · 选文思维导图（PDF 第16页）', 16);
  const first = map('first', '1.2 机器学习中的最优化问题 · 思维导图', 9);
  const second = map('second', '1.2 机器学习中的最优化问题 · 复习思维导图', 9);
  assert.deepEqual(ids([detail, first, second]), ['first', 'second', 'detail']);
  assert.equal(mindmapPlacement(first, book).label, '第1章 · 第2节 · 整节');
  assert.equal(mindmapPlacement(detail, book).label, '第1章 · 第2节 · 选文');
  assert.equal(mindmapPlacement(map('plain', '机器学习中的最优化问题 · 思维导图', 9), book).label, '第1章 · 第2节 · 整节');
});

test('explicit source wins over misleading or edited titles and node text', () => {
  const item = map('saved', '全书思维导图', 9, { scope: 'selection', page: 22, chapterId: 'c2', sectionId: 's22' });
  assert.equal(mindmapPlacement(item, book).label, '第2章 · 第2节 · 选文');
  assert.deepEqual(ids([item, map('first', '第一章思维导图', 7)]), ['first', 'saved']);
  assert.equal(mindmapPlacement(map('page-source', '第一章思维导图', 9, { scope: 'selection', page: 22 }), book).label, '第2章 · 第2节 · 选文');
});

test('a PDF page citation in a chapter title does not turn a chapter total into a single-page map', () => {
  assert.equal(mindmapPlacement(map('c2', '第二章思维导图（PDF 第18页）', 18), book).label, '第2章 · 整章');
});

test('same-name same-page siblings only identify their shared parent, not a guessed section total', () => {
  const ambiguous = { chapters: [
    { id: 'c', title: '第一章', level: 0, page: 1 },
    { id: 's1', title: '概要', level: 1, page: 2 },
    { id: 's2', title: '概要', level: 1, page: 2 },
  ] };
  assert.equal(mindmapPlacement(map('a', '概要 · 思维导图', 2), ambiguous).label, '第1章 · 局部内容');
});

test('same-page chapter and section totals remain distinct, explicit section ID resolves same-page siblings', () => {
  const shared = { chapters: [chapters[6], chapters[7], { id: 's2b', title: '附加说明', level: 1, page: 18 }] };
  assert.equal(mindmapPlacement(map('c', '最优化理论 · 思维导图', 18), shared).label, '第1章 · 整章');
  assert.equal(mindmapPlacement(map('s', '最优化问题基本形式 · 思维导图', 18), shared).label, '第1章 · 第1节 · 整节');
  assert.equal(mindmapPlacement(map('id', '说明', 18, { scope: 'section', page: 18, chapterId: 'c2', sectionId: 's21' }), shared).label, '第1章 · 第1节 · 整节');
});

test('repeated section titles use their own chapter from the root page', () => {
  assert.equal(mindmapPlacement(map('summary2', '本章小结 · 思维导图', 38), book).label, '第2章 · 第3节 · 整节');
  assert.equal(mindmapPlacement(map('summary1', '本章小结 · 思维导图', 17), book).label, '第1章 · 第3节 · 整节');
});

test('root citation is used before child citations, without treating a page as a total', () => {
  const item = map('excerpt', '相关内容', 22);
  item.nodes.unshift({ id: 'child', label: '背景参考', page: 7 });
  item.edges.push({ source: 'root', target: 'child' });
  assert.equal(mindmapPlacement(item, book).label, '第2章 · 第2节 · 局部内容');
});

test('natural chapter/section numbering works without an outline and keeps totals first', () => {
  const items = [map('ten', '第十章思维导图'), map('s210', '2.10 思维导图'), map('s22', '2.2 思维导图'), map('two', '第二章思维导图'), map('book', '全书思维导图')];
  assert.deepEqual(sortMindmaps(items, { chapters: [] }).map(item => item.id), ['book', 'two', 's22', 's210', 'ten']);
});

test('directory order is authoritative for printed chapter numbers', () => {
  const printed = { chapters: [{ id: 'a', title: '第2章 起点', page: 10, level: 0 }, { id: 'b', title: '第10章 终点', page: 50, level: 0 }] };
  assert.deepEqual(sortMindmaps([map('ten', '第10章 · 思维导图', 50), map('two', '第2章 · 思维导图', 10)], printed).map(item => item.id), ['two', 'ten']);
});

test('unlocated results stay visible after located ones; missing outline and citations do not crash', () => {
  assert.deepEqual(ids([map('unknown', '未命名'), map('preface', '前言摘录', 1), map('known', '1.2 思维导图', 9)]), ['known', 'preface', 'unknown']);
  assert.equal(mindmapPlacement(map('unknown', '未命名')).label, '范围未标注');
  assert.equal(mindmapPlacement(map('page', '选文', 20)).label, '选文 · PDF 第20页');
});

test('same-scope duplicates are stable; mixed materials keep their positions and input is not mutated', () => {
  const note: Artifact = { id: 'note', title: '讲解', kind: 'markdown', content: '正文' };
  const items = [map('local', '强化学习 · 选文思维导图', 16), note, map('first', '1.2 思维导图', 9), map('second', '1.2 复习思维导图', 9)];
  const original = [...items];
  const sorted = sortMindmaps(items, book);
  assert.deepEqual(sorted.map(item => item.id), ['first', 'note', 'second', 'local']);
  assert.deepEqual(items, original);
  assert.equal(sorted[1], note);
});
