import assert from 'node:assert/strict';
import test from 'node:test';
import { getReadingScope } from '../src/lib/reading-scope.ts';
import type { Chapter } from '../src/lib/types.ts';

const outline: Chapter[] = [
  { id: 'chapter-1', title: '第一章', page: 7, level: 0 },
  { id: 'section-1-1', title: '1.1', page: 8, level: 1 },
  { id: 'section-1-2', title: '1.2', page: 9, level: 1 },
  { id: 'subsection-1-2-1', title: '1.2.1', page: 10, level: 2 },
  { id: 'subsection-1-2-2', title: '1.2.2', page: 12, level: 2 },
  { id: 'chapter-2', title: '第二章', page: 18, level: 0 },
  { id: 'section-2-1', title: '2.1', page: 18, level: 1 },
  { id: 'chapter-3', title: '第三章（未分节）', page: 40, level: 0 },
];

test('a subsection belongs to its parent section and chapter', () => {
  assert.deepEqual(getReadingScope(outline, 10), { chapter: outline[0], section: outline[2] });
  assert.deepEqual(getReadingScope(outline, 17), { chapter: outline[0], section: outline[2] });
});

test('chapter and first section can start on the same page', () => {
  assert.deepEqual(getReadingScope(outline, 18), { chapter: outline[5], section: outline[6] });
});

test('a chapter opening does not select a future section', () => {
  assert.deepEqual(getReadingScope(outline, 7), { chapter: outline[0], section: undefined });
});

test('a chapter with no sections never reuses the previous chapter’s section', () => {
  assert.deepEqual(getReadingScope(outline, 40), { chapter: outline[7], section: undefined });
  assert.deepEqual(getReadingScope(outline, 202), { chapter: outline[7], section: undefined });
});

test('front matter and a missing outline leave the scope unidentified', () => {
  assert.deepEqual(getReadingScope(outline, 1), {});
  assert.deepEqual(getReadingScope([], 10), {});
});

test('backward bookmarks do not replace the closest chapter or section', () => {
  const unsorted = [
    outline[0], outline[1], outline[2],
    { id: 'back-to-section', title: '回到 1.1', page: 8, level: 1 },
    outline[5], outline[6],
    { id: 'back-to-cover', title: '回到封面', page: 1, level: 0 },
  ];
  assert.deepEqual(getReadingScope(unsorted, 14), { chapter: outline[0], section: outline[2] });
  assert.deepEqual(getReadingScope(unsorted, 20), { chapter: outline[5], section: outline[6] });
});
