import type { Chapter } from './types';

/** PDF outlines are in tree order: level 0 is a chapter, level 1 is a section. */
export function getReadingScope(chapters: Chapter[], page: number): { chapter?: Chapter; section?: Chapter } {
  let chapterIndex = -1;
  chapters.forEach((item, index) => {
    if (item.level === 0 && item.page <= page
      && (chapterIndex < 0 || item.page >= chapters[chapterIndex].page)) chapterIndex = index;
  });
  if (chapterIndex < 0) return {};

  const chapter = chapters[chapterIndex];
  let section: Chapter | undefined;
  for (let index = chapterIndex + 1; index < chapters.length; index++) {
    const item = chapters[index];
    if (item.level === 0) break;
    if (item.level === 1 && item.page >= chapter.page && item.page <= page
      && (!section || item.page >= section.page)) section = item;
  }
  return { chapter, section };
}
