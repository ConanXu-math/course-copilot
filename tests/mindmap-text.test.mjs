import assert from 'node:assert/strict';
import test from 'node:test';
import { getMindmapText, normalizeMindmapNode } from '../shared/mindmap-text.mjs';

const split = (originalLabel, label) => getMindmapText({ originalLabel, label });

test('generated text is immutable and produces no duplicate addition', () => {
  assert.deepEqual(getMindmapText({ label: '生成原文' }), { original: '生成原文', addition: '' });
  assert.deepEqual(split('生成原文', '生成原文'), { original: '生成原文', addition: '' });
});

test('the actual logic-regression legacy replacement restores removed text and extracts only 1', () => {
  const original = '$\\ell_1$-正则逻辑回归';
  assert.deepEqual(split(original, '$\\ell_1$-正则逻辑1'), { original, addition: '1' });
});

test('the actual margin example preserves only the appended digits and formula', () => {
  const original = '硬边距：线性可分时最大化间隔';
  const addition = '111111111111111111$\\in$';
  assert.deepEqual(split(original, original + addition), { original, addition });
});

test('prefix, suffix and multiple middle insertions retain their original order', () => {
  assert.equal(split('核心概念', '补充核心概念').addition, '补充');
  assert.equal(split('核心概念', '核心概念补充').addition, '补充');
  assert.equal(split('甲乙丙丁', '头甲中乙丙末丁尾').addition, '头中末尾');
});

test('replacement yields the new words while deleting the whole label yields no addition', () => {
  assert.deepEqual(split('线性模型', '非线性模型'), { original: '线性模型', addition: '非' });
  assert.deepEqual(split('第一步：读教材', '第一步：做习题'), { original: '第一步：读教材', addition: '做习题' });
  assert.deepEqual(split('完整生成原文', ''), { original: '完整生成原文', addition: '' });
  assert.equal(split('甲乙丙丁', '甲丁').addition, '');
});

test('Unicode supplementary characters are never split into lone surrogates', () => {
  assert.deepEqual(split('甲😀乙𠮷丙', '甲🧠😀乙𠮷📝丙'), { original: '甲😀乙𠮷丙', addition: '🧠📝' });
  assert.equal(split('😀', '🧠').addition, '🧠');
});

test('explicit userText wins, including empty text, preserving formatting exactly', () => {
  assert.deepEqual(getMindmapText({ originalLabel: '原文', label: '旧修改', userText: '' }), { original: '原文', addition: '' });
  assert.deepEqual(getMindmapText({ originalLabel: '原文', label: '旧修改', userText: '\n  我的补充\n' }), { original: '原文', addition: '\n  我的补充\n' });
  assert.deepEqual(getMindmapText({ label: '原文', userText: '原文' }), { original: '原文', addition: '原文' });
});

test('normalization is immutable, preserves metadata and is idempotent', () => {
  const node = { id: 'n1', page: 16, originalLabel: '原文', label: '原文补充', extra: { retained: true } };
  const normalized = normalizeMindmapNode(node);
  assert.deepEqual(normalized, { ...node, label: '原文', userText: '补充' });
  assert.equal(node.label, '原文补充');
  assert.equal(normalized.extra, node.extra);
  assert.deepEqual(normalizeMindmapNode(normalized), normalized);
  assert.deepEqual(normalizeMindmapNode({ label: '原文' }), { label: '原文', userText: '' });
});

test('explicit clearing survives normalization of stale legacy labels', () => {
  const normalized = normalizeMindmapNode({ label: '旧新增', originalLabel: '原文', userText: '' });
  assert.deepEqual(getMindmapText(normalized), { original: '原文', addition: '' });
  assert.equal(normalized.userText, '');
});

test('long labels with distant edits use bounded-memory alignment without copying unchanged text', () => {
  const middle = '甲乙丙丁戊己庚辛壬癸'.repeat(1500);
  const original = '始' + middle + '终';
  const edited = '始🧠' + middle + '📝终';
  assert.deepEqual(split(original, edited), { original, addition: '🧠📝' });
});

test('very long complete rewrites and deletions do not require an unbounded matrix', () => {
  const original = '甲'.repeat(15_000);
  const edited = '乙'.repeat(15_000);
  assert.equal(split(original, edited).addition, edited);
  assert.equal(split(original, '').addition, '');
});
