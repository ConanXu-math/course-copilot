import { fileURLToPath } from 'node:url';

// 教学材料 Skill 的默认路径根据项目位置计算。
export const materialsSkills = [
  {
    id: 'slides',
    title: '生成课件',
    description: '使用 LaTeX Beamer 按教材章节生成 PDF 课件和可修改的源文件。',
    path: fileURLToPath(new URL('../../skills/textbook-to-ppt/SKILL.md', import.meta.url)),
  },
  {
    id: 'video',
    title: '讲解视频',
    description: '把选定内容制作成讲解视频。',
    path: null,
  },
];
