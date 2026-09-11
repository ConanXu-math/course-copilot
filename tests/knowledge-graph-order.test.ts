import assert from 'node:assert/strict';
import test from 'node:test';
import { graphPlacement, sortGraphArtifacts, mindmapPlacement, sortMindmaps } from '../src/lib/artifact-order.ts';
import type { Artifact, ArtifactSource, Chapter } from '../src/lib/types.ts';

type GraphArtifact = Extract<Artifact, { kind: 'mindmap' | 'knowledge-graph' }>;
const chapters: Chapter[] = [
  { id: 'c1', title: '学习基础', level: 0, page: 5 },
  { id: 's11', title: '数据', level: 1, page: 6 },
  { id: 's12', title: '模型', level: 1, page: 12 },
  { id: 'c2', title: '优化方法', level: 0, page: 30 },
  { id: 's21', title: '梯度', level: 1, page: 31 },
  { id: 's22', title: '对偶', level: 1, page: 40 },
  { id: 'c3', title: '应用', level: 0, page: 60 },
  { id: 's31', title: '视觉', level: 1, page: 61 },
  { id: 's32', title: '语言', level: 1, page: 70 },
];
const book = { chapters };
function graph(id: string, title: string, page?: number, source?: ArtifactSource, kind: GraphArtifact['kind'] = 'knowledge-graph'): GraphArtifact {
  return { id, title, kind, source, nodes: [{ id: 'root', label: title, page }], edges: [] };
}
const ids = (items: Artifact[]) => sortGraphArtifacts(items, book).map(item => item.id);

test('knowledge graphs follow book, chapter, section and local scope order across multiple chapters', () => {
  const items = [
    graph('s22-local', '选文图', 47, { scope: 'selection', page: 47, chapterId: 'c2', sectionId: 's22' }),
    graph('c3', '第三章总图', 75, { scope: 'chapter', page: 75, chapterId: 'c3' }),
    graph('s12-local', '单页图', 14, { scope: 'page', page: 14, chapterId: 'c1', sectionId: 's12' }),
    graph('c2', '第二章总图', 44, { scope: 'chapter', page: 44, chapterId: 'c2' }),
    graph('s11-local', '选文图', 7, { scope: 'selection', page: 7, chapterId: 'c1', sectionId: 's11' }),
    graph('s21-local', '单页图', 34, { scope: 'page', page: 34, chapterId: 'c2', sectionId: 's21' }),
    graph('s12', '节总图', 16, { scope: 'section', page: 16, chapterId: 'c1', sectionId: 's12' }),
    graph('s22', '节总图', 45, { scope: 'section', page: 45, chapterId: 'c2', sectionId: 's22' }),
    graph('whole', '完整图谱', 75, { scope: 'book', page: 75 }),
    graph('c1', '第一章总图', 17, { scope: 'chapter', page: 17, chapterId: 'c1' }),
    graph('s21', '节总图', 35, { scope: 'section', page: 35, chapterId: 'c2', sectionId: 's21' }),
    graph('s11', '节总图', 8, { scope: 'section', page: 8, chapterId: 'c1', sectionId: 's11' }),
  ];
  assert.deepEqual(ids(items), ['whole', 'c1', 's11', 's11-local', 's12', 's12-local', 'c2', 's21', 's21-local', 's22', 's22-local', 'c3']);
});

test('legacy knowledge-graph suffixes identify totals even without a title separator', () => {
  assert.equal(graphPlacement(graph('chapter', '优化方法知识图谱', 35), book).label, '第2章 · 整章');
  assert.equal(graphPlacement(graph('section', '模型复习知识图谱', 16), book).label, '第1章 · 第2节 · 整节');
  assert.equal(graphPlacement(graph('section-separated', '梯度 · 知识图谱', 35), book).label, '第2章 · 第1节 · 整节');
  assert.equal(graphPlacement(graph('whole', '整本教材知识图谱', 70), book).label, '全书');
  assert.equal(graphPlacement(graph('excerpt', '模型 · 选文知识图谱（PDF 第16页）', 16), book).label, '第1章 · 第2节 · 选文');
});

test('the saved legacy title with an embedded 第 1.2 节 identifies a section total despite a repeated chapter title', () => {
  const sharedTitle = '机器学习中的最优化问题';
  const outline = { chapters: [
    { id: 'c1', title: sharedTitle, level: 0, page: 7 },
    { id: 's11', title: '为什么学习最优化', level: 1, page: 8 },
    { id: 's12', title: sharedTitle, level: 1, page: 9 },
  ] };
  const legacy = graph('actual-title', '机器学习中的最优化问题（第 1.2 节）· 知识图谱', 9);
  assert.equal(graphPlacement(legacy, outline).label, '第1章 · 第2节 · 整节');
});

test('numbered legacy graph titles use numeric section order 2.2 before 2.10 without an outline', () => {
  const items = [
    graph('ten', '第十章知识图谱'),
    graph('s210', '2.10知识图谱'),
    graph('s22', '2.2知识图谱'),
    graph('two', '第二章知识图谱'),
    graph('whole', '全书知识图谱'),
  ];
  assert.deepEqual(sortGraphArtifacts(items, { chapters: [] }).map(item => item.id), ['whole', 'two', 's22', 's210', 'ten']);
  assert.equal(graphPlacement(items[1], { chapters: [] }).label, '第2章 · 第10节 · 整节');
});

test('saved source metadata outranks edited whole-book titles, node pages and stale outline titles', () => {
  const selected = graph('selected', '全书知识图谱', 6, { scope: 'selection', page: 42, chapterId: 'c2', sectionId: 's22' });
  assert.equal(graphPlacement(selected, book).label, '第2章 · 第2节 · 选文');
  const locatedByPage = graph('page-source', '学习基础知识图谱', 6, { scope: 'section', page: 42 });
  assert.equal(graphPlacement(locatedByPage, book).label, '第2章 · 第2节 · 整节');
  assert.deepEqual(ids([selected, graph('chapter1', '学习基础知识图谱', 5)]), ['chapter1', 'selected']);
});

test('legacy cyclic knowledge graphs locate by the earliest valid node page without assuming a tree root', () => {
  const cyclic = graph('cyclic', '互联关系');
  cyclic.nodes = [
    { id: 'later', label: '后续概念', page: 65 },
    { id: 'first', label: '最早概念', page: 13 },
    { id: 'middle', label: '中间概念', page: 42 },
  ];
  cyclic.edges = [{ source: 'later', target: 'first' }, { source: 'first', target: 'middle' }, { source: 'middle', target: 'later' }];
  assert.equal(graphPlacement(cyclic, book).label, '第1章 · 第2节 · 局部内容');
  const withApparentRoot = structuredClone(cyclic);
  withApparentRoot.nodes.unshift({ id: 'unconnected-root', label: '独立概念', page: 75 });
  assert.deepEqual(graphPlacement(withApparentRoot, book), graphPlacement(cyclic, book), 'an apparent graph root must not override its earliest citation');
  withApparentRoot.nodes.reverse();
  assert.deepEqual(graphPlacement(withApparentRoot, book), graphPlacement(cyclic, book), 'node array order does not change placement');
});

test('invalid citations are ignored and unknown graphs remain visible in their stable order', () => {
  const invalid = graph('unknown-first', '未命名知识图谱');
  invalid.nodes = [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY].map((page, index) => ({ id: `bad-${index}`, label: '无效引用', page }));
  const unknown = graph('unknown-second', '尚无范围');
  const preface = graph('preface', '前言局部内容', 1);
  const known = graph('known', '模型知识图谱', 13);
  assert.equal(graphPlacement(invalid, book).label, '范围未标注');
  assert.deepEqual(ids([invalid, preface, unknown, known]), ['known', 'preface', 'unknown-first', 'unknown-second']);
  invalid.nodes.push({ id: 'valid', label: '有效引用', page: 13 });
  assert.equal(graphPlacement(invalid, book).label, '第1章 · 第2节 · 局部内容');
});

test('each graph kind sorts independently in its original slots, with stable ties and unchanged other materials', () => {
  const kgLocal = graph('kg-local', '模型选文知识图谱', 16, { scope: 'selection', page: 16, chapterId: 'c1', sectionId: 's12' });
  const kgFirst = graph('kg-first', '模型知识图谱', 13);
  const kgSecond = graph('kg-second', '模型复习知识图谱', 13);
  const kgBook = graph('kg-book', '全书知识图谱', 75);
  const mmLocal = graph('mm-local', '模型选文思维导图', 16, { scope: 'selection', page: 16, chapterId: 'c1', sectionId: 's12' }, 'mindmap');
  const mmFirst = graph('mm-first', '模型思维导图', 13, undefined, 'mindmap');
  const mmSecond = graph('mm-second', '模型复习思维导图', 13, undefined, 'mindmap');
  const mmBook = graph('mm-book', '全书思维导图', 75, undefined, 'mindmap');
  const note: Artifact = { id: 'note', kind: 'markdown', title: '笔记', content: '保留原位' };
  const slides: Artifact = { id: 'slides', kind: 'slides', title: '课件', slides: [] };
  const video: Artifact = { id: 'video', kind: 'video', title: '视频', url: '/fixture.mp4' };
  const items = [kgLocal, note, mmLocal, kgFirst, slides, mmBook, kgBook, mmFirst, kgSecond, video, mmSecond];
  const before = structuredClone(items);
  const sorted = sortGraphArtifacts(items, book);
  assert.deepEqual(sorted.map(item => item.id), ['kg-book', 'note', 'mm-book', 'kg-first', 'slides', 'mm-first', 'kg-second', 'mm-second', 'kg-local', 'video', 'mm-local']);
  assert.deepEqual(sorted.map(item => item.kind), items.map(item => item.kind));
  assert.equal(sorted[1], note);
  assert.equal(sorted[4], slides);
  assert.equal(sorted[9], video);
  assert.equal(sorted[3], kgFirst, 'sorting retains original artifact objects');
  assert.deepEqual(items, before, 'sorting must not mutate input data');
  assert.deepEqual(sortGraphArtifacts(sorted, book), sorted, 'reapplying the order is stable');
});

test('the original mindmap APIs stay compatible and keep knowledge-graph slots untouched', () => {
  const kgLocal = graph('kg-local', '模型选文知识图谱', 16);
  const kgBook = graph('kg-book', '全书知识图谱', 75);
  const mmLocal = graph('mm-local', '模型选文思维导图', 16, undefined, 'mindmap');
  const mmBook = graph('mm-book', '全书思维导图', 75, undefined, 'mindmap');
  assert.deepEqual(sortMindmaps([kgLocal, mmLocal, kgBook, mmBook], book).map(item => item.id), ['kg-local', 'mm-book', 'kg-book', 'mm-local']);
  assert.deepEqual(graphPlacement(mmLocal, book), mindmapPlacement(mmLocal, book));
  const rootBased = graph('tree', '局部内容', 42, undefined, 'mindmap');
  rootBased.nodes.push({ id: 'child', label: '背景', page: 6 });
  rootBased.edges.push({ source: 'root', target: 'child' });
  assert.equal(graphPlacement(rootBased, book).label, '第2章 · 第2节 · 局部内容', 'mindmap root citation precedence is retained');
});
