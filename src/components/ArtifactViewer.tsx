import { useMemo, useState } from 'react';
import { Background, Controls, ReactFlow, type Node, type Edge } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { ArrowLeft, ArrowRight, Download, FileText, FolderOpen, ExternalLink, Waypoints, Video, Presentation } from 'lucide-react';
import type { Artifact, Book } from '../lib/types';
import Markdown from './Markdown';
import '@xyflow/react/dist/style.css';
import './pdf-slides.css';

function safeUrl(value: string) {
  try { const url = new URL(value, window.location.href); return ['http:', 'https:', 'blob:'].includes(url.protocol) ? url.href : undefined; }
  catch { return undefined; }
}

function GraphView({ artifact, onPage, book }: { book?: Book; artifact: Extract<Artifact, {kind:'mindmap'|'knowledge-graph'}>; onPage:(page:number)=>void }) {
  const {nodes,edges} = useMemo(() => {
    const graph = new dagre.graphlib.Graph().setGraph({rankdir:'LR',nodesep:38,ranksep:90}).setDefaultEdgeLabel(() => ({}));
    artifact.nodes.forEach(node => graph.setNode(node.id, {width:190,height:66}));
    const ids = new Set(artifact.nodes.map(node => node.id));
    const validEdges = artifact.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
    validEdges.forEach(edge => graph.setEdge(edge.source, edge.target));
    dagre.layout(graph);
    return {
      nodes: artifact.nodes.map(node => ({ id:node.id, data:{label:<Markdown book={book}>{node.label}</Markdown>,page:node.page}, position:{x:graph.node(node.id).x-95,y:graph.node(node.id).y-33}, sourcePosition:'right', targetPosition:'left', style:{width:190,minHeight:66} })) as Node[],
      edges: validEdges.map((edge,index) => ({id:`edge-${index}`,source:edge.source,target:edge.target,label:edge.label,type:'smoothstep'})) as Edge[],
    };
  }, [artifact, book]);
  if (!nodes.length) return <div className="artifact-empty">这份资料还没有知识点。</div>;
  return <div className="graph-view"><ReactFlow nodes={nodes} edges={edges} fitView fitViewOptions={{padding:0.2}} nodesDraggable={false} nodesConnectable={false} onNodeClick={(_,node) => { if (typeof node.data.page === 'number') onPage(node.data.page); }}><Background color="#e1dada" gap={24}/><Controls showInteractive={false}/></ReactFlow><p className="graph-hint">拖动画布浏览 · 滚轮缩放 · 点击带页码的知识点返回教材</p></div>;
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

export default function ArtifactViewer({artifact,onPage,book}:{artifact:Artifact;onPage:(page:number)=>void;book?:Book}) {
  const url = 'url' in artifact && artifact.url ? safeUrl(artifact.url) : undefined;
  function downloadText() {
    if (artifact.kind !== 'markdown') return;
    const blobUrl=URL.createObjectURL(new Blob([artifact.content],{type:'text/markdown;charset=utf-8'}));
    const a=document.createElement('a'); a.href=blobUrl; a.download=`${artifact.title}.md`; a.click(); setTimeout(()=>URL.revokeObjectURL(blobUrl),1000);
  }
  return <section className="artifact-viewer"><div className="artifact-toolbar"><span><FileText size={16}/>{artifact.title}</span>{artifact.kind==='markdown' && <button className="text-button" onClick={downloadText}><Download size={15}/>下载</button>}{url && <a className="text-button" href={url} target="_blank" rel="noreferrer"><ExternalLink size={15}/>打开文件</a>}</div>
    {artifact.kind==='markdown' && <div className="artifact-document"><Markdown book={book}>{artifact.content}</Markdown></div>}
    {(artifact.kind==='mindmap'||artifact.kind==='knowledge-graph') && <GraphView artifact={artifact} onPage={onPage} book={book}/>}
    {artifact.kind==='slides' && (artifact.chapters?.length ? <PdfSlidesView key={artifact.id} artifact={artifact}/> : <SlidesView key={artifact.id} artifact={artifact} book={book}/>)}
    {artifact.kind==='video' && (url ? <div className="video-view"><video key={url} src={url} controls preload="metadata"/><p>{artifact.title}</p></div> : <div className="artifact-empty">视频地址无效，无法播放。</div>)}
    {artifact.kind==='file' && <div className="file-view"><FileText size={42} strokeWidth={1.25}/><h2>{artifact.title}</h2><p>{artifact.filename || '课程资料'}</p>{url ? <a className="primary-button" href={url} target="_blank" rel="noreferrer"><Download size={16}/>打开或下载</a> : <p>文件地址无效，无法打开。</p>}</div>}
  </section>;
}

export function MaterialsLibrary({artifacts,onOpen}:{artifacts:Artifact[];onOpen:(artifact:Artifact)=>void}) {
  return <div className="materials-library"><div className="materials-heading"><span className="eyebrow">YOUR LEARNING MATERIALS</span><h1>让知识留下来</h1><p>思维导图、课件和讲解视频，都收在这本教材里。</p></div>{artifacts.length ? <div className="materials-list">{artifacts.map(artifact => <button key={artifact.id} onClick={()=>onOpen(artifact)}><FileText size={22}/><span><strong>{artifact.title}</strong><small>{{markdown:'讲解笔记',mindmap:'思维导图','knowledge-graph':'知识图谱',slides:'课件',video:'视频',file:'文件'}[artifact.kind]}</small></span><ExternalLink size={16}/></button>)}</div> : <div className="materials-empty"><span className="empty-folder"><FolderOpen size={40} strokeWidth={1.3}/></span><h2>你的第一份学习资料，从这里开始</h2><p>在右侧选择学习工具。生成完成后，<br/>资料会自动出现在这里，随时回来查看。</p><div className="empty-material-types"><span><Waypoints size={16}/>知识结构</span><span><Presentation size={16}/>章节课件</span><span><Video size={16}/>讲解视频</span></div></div>}</div>;
}
