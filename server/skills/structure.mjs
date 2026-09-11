import { fileURLToPath } from 'node:url';

// 同学 B 维护课程结构 Skills。个人设置中的路径优先于仓库默认值。
export const structureSkills = [
  {
    id: 'mindmap',
    title: '思维导图',
    description: '整理知识点的层次与章节结构。',
    path: fileURLToPath(new URL('../../skills/mindmap/SKILL.md', import.meta.url)),
  },
  {
    id: 'knowledge-graph',
    title: '知识图谱',
    description: '呈现概念之间的联系与学习顺序。',
    path: fileURLToPath(new URL('../../skills/knowledge-graph/SKILL.md', import.meta.url)),
  },
];
