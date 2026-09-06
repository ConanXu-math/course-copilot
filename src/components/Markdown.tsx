import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { Book } from '../lib/types';

export default function Markdown({ children, book }: { children: string; book?: Book }) {
  // Codex 常用 \(…\) 和 \[…\]；统一成阅读器支持的数学分隔符，并保留代码内容。
  const content = children.replace(/(`+)[\s\S]*?\1|(~{3,})[\s\S]*?\2|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)/g,
    (match, _backticks, _tildes, block: string | undefined, inline: string | undefined) =>
      block !== undefined ? `\n\n$$\n${block.trim()}\n$$\n\n` : inline !== undefined ? `$${inline}$` : match);
  function courseUrl(value?: string) {
    if (!value || !book?.directory || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) return value;
    const ending = value.search(/[?#]/);
    const suffix = ending < 0 ? '' : value.slice(ending);
    let path;
    try { path = decodeURIComponent(ending < 0 ? value : value.slice(0, ending)); }
    catch { return value; }
    if (path === `${book.directory}/textbook.pdf`) return `${book.url}${suffix}`;
    const outputs = `${book.directory}/outputs/`;
    const relative = path.startsWith(outputs) ? path.slice(outputs.length) : path.startsWith('outputs/') ? path.slice(8) : path.startsWith('/') ? undefined : path.replace(/^\.\//, '');
    if (!relative) return value;
    if (relative.split('/').some(part => !part || part === '.' || part === '..')) return undefined;
    return `/api/courses/${encodeURIComponent(book.id)}/outputs/${relative.split('/').map(encodeURIComponent).join('/')}${suffix}`;
  }
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{
    a: ({ children, href }) => <a href={courseUrl(href)} target="_blank" rel="noreferrer">{children}</a>,
    img: ({ src, alt }) => <img src={courseUrl(src)} alt={alt || ''} loading="lazy" />,
  }}>{content}</ReactMarkdown></div>;
}
