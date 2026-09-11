import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, ReactFlow, type Node, type Edge, type NodeChange, type ReactFlowInstance } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { ArrowLeft, ArrowRight, Download, File as FileIcon, FileText, FolderOpen, ExternalLink, Network, Waypoints, Video, Presentation, Pencil, X, LoaderCircle } from 'lucide-react';
import type { Artifact, Book } from '../lib/types';
import { graphPlacement, sortGraphArtifacts } from '../lib/artifact-order';
import KnowledgeGraphView from './KnowledgeGraphView';
import { getMindmapText } from '../../shared/mindmap-text.mjs';
import Markdown from './Markdown';
import QuizView, { type QuizAction } from './QuizView';
import '@xyflow/react/dist/style.css';
import './graph-edit.css';
import './pdf-slides.css';

type EditNode = (nodeId: string, userText: string) => Promise<void>;
function safeUrl(value: string) {
  try { const url = new URL(value, window.location.href); return ['http:', 'https:', 'blob:'].includes(url.protocol) ? url.href : undefined; }
  catch { return undefined; }
}

function GraphLabel({ id, original, addition, book, onWidth }: { id: string; original: string; addition: string; book?: Book; onWidth: (id: string, width: number) => void }) {
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!content.current) return;
    // KaTeX bases can contain indivisible matrices or fractions. Let these widen
    // the node while ordinary text wraps at the usual reading width.
    const formulas = [...content.current.querySelectorAll<HTMLElement>('.katex .base')];
    const measure = () => onWidth(id, Math.max(190, ...formulas.map(formula => Math.ceil(formula.offsetWidth) + 24)));
    measure();
    const observer = new ResizeObserver(measure);
    formulas.forEach(formula => observer.observe(formula));
    return () => observer.disconnect();
  }, [id, original, addition, book, onWidth]);
  return <div ref={content} className="graph-node-label">
    <div className="graph-node-original"><Markdown book={book}>{original}</Markdown></div>
    {addition.trim() && <div className="graph-node-addition"><Markdown book={book}>{addition}</Markdown></div>}
  </div>;
}

function GraphView({ artifact, onPage, book, onEditNode }: { book?: Book; artifact: Extract<Artifact, {kind:'mindmap'|'knowledge-graph'}>; onPage:(page:number)=>void; onEditNode?: EditNode }) {
  const [editing, setEditing] = useState<{ id: string; original: string; addition: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const savingRef = useRef(false);
  const editable = artifact.kind === 'mindmap' && Boolean(onEditNode);
  const [nodeWidths, setNodeWidths] = useState<Record<string, number>>({});
  const [nodeSizes, setNodeSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null);
  const initiallyFitted = useRef(false);
  const measureWidth = useCallback((id: string, width: number) => {
    setNodeWidths(current => (current[id] ?? 190) === width ? current : { ...current, [id]: width });
  }, []);
  const measureNodes = useCallback((changes: NodeChange[]) => {
    setNodeSizes(current => {
      let next = current;
      for (const change of changes) {
        if (change.type !== 'dimensions' || !change.dimensions) continue;
        const { width, height } = change.dimensions;
        if (width <= 0 || height <= 0 || (current[change.id]?.width === width && current[change.id]?.height === height)) continue;
        if (next === current) next = { ...current };
        next[change.id] = { width, height };
      }
      return next;
    });
  }, []);

  const edit = useCallback((node: { id: string; label: string; originalLabel?: string; userText?: string }) => {
    if (!editable || savingRef.current) return;
    const text = getMindmapText(node);
    setEditing({ id: node.id, ...text });
    setDraft(text.addition);
    setEditError('');
  }, [editable]);

  useEffect(() => {
    if (editing) {
      if (!dialog.current?.open) dialog.current?.showModal();
      textarea.current?.focus();
    } else dialog.current?.close();
  }, [editing]);

  function cancelEdit() {
    if (savingRef.current) return;
    setEditing(null);
    setEditError('');
  }

  async function saveEdit() {
    if (!editing || !onEditNode || savingRef.current) return;
    if (draft.length > 2000) { setEditError('补充文字最多 2000 个字符，请缩短后再保存。'); textarea.current?.focus(); return; }
    if (draft === editing.addition) { cancelEdit(); return; }
    savingRef.current = true;
    setSaving(true);
    setEditError('');
    try {
      await onEditNode(editing.id, draft);
      setEditing(null);
    } catch (error) {
      setEditError(error instanceof Error && error.message ? error.message : '保存失败，请重试。');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const {nodes,edges} = useMemo(() => {
    const graph = new dagre.graphlib.Graph().setGraph({rankdir:'LR',nodesep:38,ranksep:90}).setDefaultEdgeLabel(() => ({}));
    artifact.nodes.forEach(node => graph.setNode(node.id, { width: nodeWidths[node.id] ?? 190, height: nodeSizes[node.id]?.height ?? 66 }));
    const ids = new Set(artifact.nodes.map(node => node.id));
    const validEdges = artifact.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
    validEdges.forEach(edge => graph.setEdge(edge.source, edge.target));
    dagre.layout(graph);
    return {
      nodes: artifact.nodes.map(node => {
        const mindmap = artifact.kind === 'mindmap';
        const { width, height } = graph.node(node.id);
        const text = mindmap ? getMindmapText(node) : { original: node.label, addition: '' };
        return {
          id: node.id,
          measured: nodeSizes[node.id],
          className: `course-graph-node ${mindmap ? `mindmap-node${text.addition.trim() ? ' mindmap-node-annotated' : ''}` : 'knowledge-graph-node'}`,
          data: {
            label: <div className="graph-node-content">
              <GraphLabel id={node.id} original={text.original} addition={text.addition} book={book} onWidth={measureWidth}/>
              {editable && <button type="button" className="graph-node-edit nodrag nopan" title="编辑补充文字" aria-label={`编辑补充：${text.original}`} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onClick={event => { event.preventDefault(); event.stopPropagation(); edit(node); }}><Pencil size={13}/></button>}
            </div>,
            page: node.page,
          },
          position: { x: graph.node(node.id).x - width / 2, y: graph.node(node.id).y - height / 2 },
          sourcePosition: 'right', targetPosition: 'left',
          style: { width, minHeight: 66 },
        };
      }) as Node[],
      edges: validEdges.map((edge,index) => ({ id: `edge-${index}`, source: edge.source, target: edge.target, label: edge.label, type: 'smoothstep' })) as Edge[],
    };
  }, [artifact, book, editable, edit, nodeWidths, nodeSizes, measureWidth]);
  const measured = nodes.length > 0 && nodes.every(node => nodeSizes[node.id]?.width === (nodeWidths[node.id] ?? 190));
  useEffect(() => {
    if (!flow || !measured || initiallyFitted.current) return;
    const frame = requestAnimationFrame(() => {
      initiallyFitted.current = true;
      void flow.fitView({ padding: 0.2, minZoom: 0.05, maxZoom: 1 });
    });
    return () => cancelAnimationFrame(frame);
  }, [artifact.kind, flow, measured, nodes]);
  if (!nodes.length) return <div className="artifact-empty">这份资料还没有知识点。</div>;
  return <div className="graph-view"><ReactFlow nodes={nodes} edges={edges} minZoom={0.05} nodesDraggable={false} nodesConnectable={false} onInit={setFlow} onNodesChange={measureNodes}
    onNodeClick={(_,node) => { if (typeof node.data.page === 'number') onPage(node.data.page); }}
    onNodeContextMenu={editable ? (event, node) => { event.preventDefault(); event.stopPropagation(); const source = artifact.nodes.find(item => item.id === node.id); if (source) edit(source); } : undefined}>
      <Background color="#e1dada" gap={24}/><Controls showInteractive={false}/>
    </ReactFlow><p className="graph-hint">拖动画布浏览 · 滚轮缩放 · 点击带页码的知识点返回教材{editable && ' · 右键添加或编辑蓝色补充'}</p>
    <dialog ref={dialog} className="graph-edit-dialog" aria-labelledby="graph-edit-title" onCancel={event => { event.preventDefault(); cancelEdit(); }}>
      <div className="dialog-title"><span id="graph-edit-title"><Pencil size={17}/>编辑补充文字</span><button type="button" className="icon-button" onClick={cancelEdit} disabled={saving} aria-label="关闭补充编辑"><X size={18}/></button></div>
      <form className="graph-edit-form" onSubmit={event => { event.preventDefault(); void saveEdit(); }}>
        <div className="graph-edit-original-heading">生成原文 <span>只读 · 始终为黑色</span></div>
        <div className="graph-edit-original" role="region" aria-label="生成原文（只读）"><Markdown book={book}>{editing?.original ?? ''}</Markdown></div>
        <label htmlFor="graph-node-addition">我添加的文字</label>
        <textarea ref={textarea} id="graph-node-addition" placeholder="在这里补充笔记，保存后显示为蓝色。" value={draft} onChange={event => { setDraft(event.target.value); setEditError(''); }} rows={5} disabled={saving} aria-invalid={Boolean(editError)} aria-describedby={editError ? 'graph-edit-error' : 'graph-edit-help'}/>
        <div className="graph-edit-help" id="graph-edit-help"><span>支持 Markdown 和公式；清空可删除补充。</span><span>{draft.length} / 2000</span></div>
        {editError && <p className="graph-edit-error" id="graph-edit-error" role="alert">{editError}</p>}
        <div className="graph-edit-actions"><button type="button" className="text-button" disabled={saving} onClick={cancelEdit}>取消</button><button type="submit" className="primary-button" disabled={saving}>{saving && <LoaderCircle size={15} className="spin"/>}{saving ? '正在保存…' : '保存'}</button></div>
      </form>
    </dialog>
  </div>;
}

function SlidesView({ artifact, book }: {artifact:Extract<Artifact,{kind:'slides'}>;book?:Book}) {
  const [slide,setSlide] = useState(0);
  const slides = artifact.slides || [];
  const currentIndex = Math.min(slide, Math.max(0, slides.length - 1));
  const current = slides[currentIndex];
  if (!current) return <div className="artifact-empty">这份课件还没有页面。</div>;
  return <div className="slides-view"><div className="slide-paper"><span className="eyebrow">{artifact.title}</span><h1>{current.title}</h1><Markdown book={book}>{current.content}</Markdown><span className="slide-number">{String(currentIndex+1).padStart(2,'0')}</span></div><div className="slide-controls"><button className="icon-button" disabled={!currentIndex} onClick={()=>setSlide(currentIndex-1)} aria-label="上一张课件"><ArrowLeft size={18}/></button><span>{currentIndex+1} / {slides.length}</span><button className="icon-button" disabled={currentIndex===slides.length-1} onClick={()=>setSlide(currentIndex+1)} aria-label="下一张课件"><ArrowRight size={18}/></button></div></div>;
}

function PdfSlidesView({ artifact }: { artifact: Extract<Artifact, { kind: 'slides' }> }) {
  const [chapterIndex, setChapterIndex] = useState(0);
  const chapters = artifact.chapters || [];
  const currentIndex = Math.min(chapterIndex, Math.max(0, chapters.length - 1));
  const chapter = chapters[currentIndex];
  const url = chapter && safeUrl(chapter.url);
  const sourceUrl = artifact.sourceUrl && safeUrl(artifact.sourceUrl);
  return <div className="pdf-slides-view">
    <div className="pdf-slides-toolbar">
      <label>章节
        <select aria-label="选择课件章节" value={currentIndex} onChange={event => setChapterIndex(Number(event.target.value))}>
          {chapters.map((item, index) => <option key={`${item.url}-${index}`} value={index}>{item.title}</option>)}
        </select>
      </label>
      {url && <>
        <a className="text-button" href={url} target="_blank" rel="noreferrer"><ExternalLink size={15}/>打开 PDF</a>
        <a className="text-button" href={url} download={chapter.filename || `${chapter.title}.pdf`}><Download size={15}/>下载 PDF</a>
      </>}
      {sourceUrl && <a className="text-button" href={sourceUrl} download="sources.zip"><Download size={15}/>LaTeX 源文件</a>}
    </div>
    {url ? <iframe key={url} className="pdf-slides-frame" src={url} title={chapter.title}/> : <div className="artifact-empty">课件 PDF 地址无效，请重新生成。</div>}
  </div>;
}

export default function ArtifactViewer({artifact,onPage,book,onEditNode,onQuizAction}:{artifact:Artifact;onPage:(page:number)=>void;book?:Book;onEditNode?:EditNode;onQuizAction?:QuizAction}) {
  const url = 'url' in artifact && artifact.url ? safeUrl(artifact.url) : undefined;
  function downloadText() {
    if (artifact.kind !== 'markdown') return;
    const blobUrl=URL.createObjectURL(new Blob([artifact.content],{type:'text/markdown;charset=utf-8'}));
    const a=document.createElement('a'); a.href=blobUrl; a.download=`${artifact.title}.md`; a.click(); setTimeout(()=>URL.revokeObjectURL(blobUrl),1000);
  }
  return <section className="artifact-viewer"><div className="artifact-toolbar"><span><FileText size={16}/>{artifact.title}</span>{artifact.kind==='markdown' && <button className="text-button" onClick={downloadText}><Download size={15}/>下载</button>}{url && <a className="text-button" href={url} target="_blank" rel="noreferrer"><ExternalLink size={15}/>打开文件</a>}</div>
    {artifact.kind==='quiz' && <QuizView artifact={artifact} book={book} onPage={onPage} onAction={onQuizAction}/>}
    {artifact.kind==='markdown' && <div className="artifact-document"><Markdown book={book}>{artifact.content}</Markdown></div>}
    {artifact.kind==='mindmap' && <GraphView artifact={artifact} onPage={onPage} book={book} onEditNode={onEditNode}/>}
    {artifact.kind==='knowledge-graph' && <KnowledgeGraphView artifact={artifact} onPage={onPage} book={book}/>}
    {artifact.kind==='slides' && (artifact.chapters?.length ? <PdfSlidesView key={artifact.id} artifact={artifact}/> : <SlidesView key={artifact.id} artifact={artifact} book={book}/>)}
    {artifact.kind==='video' && (url ? <div className="video-view"><video key={url} src={url} controls preload="metadata"/><p>{artifact.title}</p></div> : <div className="artifact-empty">视频地址无效，无法播放。</div>)}
    {artifact.kind==='file' && <div className="file-view"><FileText size={42} strokeWidth={1.25}/><h2>{artifact.title}</h2><p>{artifact.filename || '课程资料'}</p>{url ? <a className="primary-button" href={url} target="_blank" rel="noreferrer"><Download size={16}/>打开或下载</a> : <p>文件地址无效，无法打开。</p>}</div>}
  </section>;
}

export function MaterialsLibrary({ artifacts, onOpen, kind, book }: {
  artifacts: Artifact[];
  onOpen: (artifact: Artifact) => void;
  kind?: 'mindmap' | 'knowledge-graph';
  book?: Book;
}) {
  const materialTypes = {
    quiz: { title: '练习卡片', icon: FileText },
    markdown: { title: '讲解笔记', icon: FileText },
    mindmap: { title: '思维导图', icon: Waypoints },
    'knowledge-graph': { title: '知识图谱', icon: Network },
    slides: { title: '课件', icon: Presentation },
    video: { title: '视频', icon: Video },
    file: { title: '文件', icon: FileIcon },
  };
  const category = kind ? materialTypes[kind] : null;
  const CategoryIcon = category?.icon || FolderOpen;
  const orderedArtifacts = sortGraphArtifacts(artifacts, book);
  const visibleArtifacts = kind ? orderedArtifacts.filter(artifact => artifact.kind === kind) : orderedArtifacts;
  const description = kind === 'mindmap' ? '按教材章、节顺序排列，全书、整章和整节导图分别优先。'
    : kind === 'knowledge-graph' ? '按教材章、节顺序排列，全书图谱最前，整章和整节图谱在各自范围内优先。'
    : '思维导图、课件和讲解视频，都收在这本教材里。';

  return <div className="materials-library">
    <div className="materials-heading">
      <span className="eyebrow">{category ? <CategoryIcon size={24} aria-hidden="true"/> : 'YOUR LEARNING MATERIALS'}</span>
      <h1>{category?.title || '让知识留下来'}</h1>
      <p>{description}</p>
    </div>
    {visibleArtifacts.length ? <div className="materials-list">{visibleArtifacts.map(artifact => {
      const type = materialTypes[artifact.kind];
      const ItemIcon = type.icon;
      return <button key={artifact.id} onClick={() => onOpen(artifact)}>
        <ItemIcon size={22} aria-hidden="true"/>
        <span><strong>{artifact.title}</strong><small>{type.title}{(artifact.kind === 'mindmap' || artifact.kind === 'knowledge-graph') && ` · ${graphPlacement(artifact, book).label}`}</small></span>
        <ExternalLink size={16} aria-hidden="true"/>
      </button>;
    })}</div> : <div className="materials-empty">
      <span className="empty-folder"><CategoryIcon size={40} strokeWidth={1.3} aria-hidden="true"/></span>
      <h2>{category ? `还没有${category.title}` : '你的第一份学习资料，从这里开始'}</h2>
      <p>{category ? <>在右侧的课程工具中选择“{category.title}”并生成，<br/>生成的{category.title}会保存在这里，随时回来查看。</>
        : <>在右侧选择学习工具。生成完成后，<br/>资料会自动出现在这里，随时回来查看。</>}</p>
      {!category && <div className="empty-material-types"><span><Waypoints size={16}/>知识结构</span><span><Presentation size={16}/>章节课件</span><span><Video size={16}/>讲解视频</span></div>}
    </div>}
  </div>;
}
