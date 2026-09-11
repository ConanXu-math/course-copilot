import { useEffect, useId, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import type { Element, Root, RootContent } from 'hast';

export function mathText(node: RootContent): string {
  return node.type === 'text' ? node.value : 'children' in node ? node.children.map(mathText).join('') : '';
}

// 在 KaTeX 排版前保留同一份源码，旧资料也能直接查看和复制。
export function rehypeMathSource() {
  return (tree: Root) => {
    function walk(parent: Root | Element) {
      for (let index = 0; index < parent.children.length; index++) {
        const node = parent.children[index];
        if (node.type !== 'element' || node.tagName === 'a') continue;
        const code = node.tagName === 'pre' && node.children[0]?.type === 'element' ? node.children[0] : node;
        const classes = Array.isArray(code.properties.className) ? code.properties.className : [];
        if (code.tagName === 'code' && classes.some(name => ['language-math', 'math-display', 'math-inline'].includes(String(name)))) {
          parent.children[index] = {
            type: 'element', tagName: 'span',
            properties: {
              className: [node.tagName === 'pre' || classes.includes('math-display') ? 'math-source-block' : 'math-source-inline'],
              dataLatex: mathText(code),
            },
            children: [node],
          };
        } else walk(node);
      }
    }
    walk(tree);
  };
}

function CopyLatex({ source }: { source: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  useEffect(() => {
    setState('idle');
  }, [source]);
  useEffect(() => {
    if (state !== 'copied') return;
    const timer = window.setTimeout(() => setState('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [state]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(source);
      setState('copied');
    } catch {
      setState('error');
    }
  }
  return <span className="latex-copy">
    <button type="button" className="latex-action" onClick={event => { event.stopPropagation(); void copy(); }} aria-label="复制 LaTeX 代码">
      {state === 'copied' ? <Check size={13}/> : <Copy size={13}/>}<span aria-live="polite">{state === 'copied' ? '已复制' : '复制代码'}</span>
    </button>
    {state === 'error' && <span className="latex-copy-error" role="status">复制失败，请展开并选中代码复制。</span>}
  </span>;
}

export function LatexCode({ source }: { source: string }) {
  return <div className="latex-code-block">
    <div className="latex-code-toolbar"><span>LaTeX</span><CopyLatex source={source}/></div>
    <pre><code className="language-latex">{source}</code></pre>
  </div>;
}

export default function MathFormula({ source, display, children }: { source: string; display: boolean; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const sourceId = useId();
  return <span className={`math-formula ${display ? 'math-formula-block' : 'math-formula-inline'}`}>
    {display ? children : <button type="button" className="math-inline-toggle" title="查看 LaTeX 代码" aria-label={`查看 LaTeX：${source}`} aria-expanded={expanded} aria-controls={sourceId} onClick={event => { event.stopPropagation(); setExpanded(!expanded); }}>{children}</button>}
    {display && <span className="math-actions">
      <button type="button" className="latex-action" aria-expanded={expanded} aria-controls={sourceId} onClick={event => { event.stopPropagation(); setExpanded(!expanded); }}><ChevronDown size={13} className={expanded ? 'expanded' : ''}/>{expanded ? '收起 LaTeX' : '查看 LaTeX'}</button>
      <CopyLatex source={source}/>
    </span>}
    {expanded && <span className="math-source-panel" id={sourceId}>
      {!display && <span className="latex-code-toolbar"><span>LaTeX</span><CopyLatex source={source}/></span>}
      <code>{source}</code>
    </span>}
  </span>;
}
