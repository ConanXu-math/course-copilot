import { fileURLToPath } from 'node:url';

// 同学 A 维护教材解析、讲解与出题 Skill。默认使用随项目提供的目录。
// Coding Agent 读取并使用 Skill；前端按钮不直接执行这里的文件。
export const tutoringSkills = [
  {
    id: 'textbook-parse',
    title: '教材解析',
    description: '提取教材正文、公式、图片和目录，并保留页码对应关系。',
    path: fileURLToPath(new URL('../../skills/textbook-parse/SKILL.md', import.meta.url)),
  },
  {
    id: 'explain',
    title: '讲解内容',
    description: '解释当前页、章节或选中的文字与公式。',
    path: fileURLToPath(new URL('../../skills/explain/SKILL.md', import.meta.url)),
  },
  {
    id: 'quiz',
    title: '知识点出题',
    description: '围绕当前知识点生成练习题，附参考答案、解析和易错点。',
    path: fileURLToPath(new URL('../../skills/quiz/SKILL.md', import.meta.url)),
  },
];
