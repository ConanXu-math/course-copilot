import { fileURLToPath } from 'node:url';

export const slideTemplates = [
  { id: 'navy', title: '白底深蓝', description: '左对齐标题，浅蓝公式框。' },
  { id: 'ivory', title: '米白宋体', description: '居中标题，宋体正文，细线分隔。' },
  { id: 'banner', title: '蓝色标题栏', description: '通栏标题，白底正文。' },
];

export const slideTemplateDirectory = fileURLToPath(new URL('../skills/textbook-to-ppt/assets/beamer/', import.meta.url));

export function selectSlideTemplate(request) {
  const previous = request.artifact?.kind === 'slides' ? request.artifact.templateId : undefined;
  const id = request.templateId ?? previous ?? 'navy';
  return slideTemplates.find(template => template.id === id) || slideTemplates[0];
}
