import { useEffect, useRef } from 'react';
import { AlertCircle, ArrowUpRight, BookOpen, Check, FileSliders, FolderOpen, History, LoaderCircle, MessageCircle, Network, Plus, Sparkles, Waypoints, X } from 'lucide-react';
import type { Artifact, Book, Chapter, Message } from '../lib/types';
import ArtifactViewer, { MaterialsLibrary } from './ArtifactViewer';
import Markdown from './Markdown';

export type ResultSection = 'conversation' | 'materials' | 'mindmaps' | 'knowledge-graphs';

const categories = [
  { id: 'conversation', title: '对话', icon: MessageCircle, kind: undefined },
  { id: 'materials', title: '学习资料', icon: FolderOpen, kind: undefined },
  { id: 'mindmaps', title: '思维导图', icon: Waypoints, kind: 'mindmap' },
  { id: 'knowledge-graphs', title: '知识图谱', icon: Network, kind: 'knowledge-graph' },
] as const;

interface Props {
  book: Book;
  page: number;
  chapter?: Chapter;
  messages: Message[];
  busy: boolean;
  artifacts: Artifact[];
  openTabs: string[];
  activeArtifact?: Artifact;
  section: ResultSection;
  onSection: (section: ResultSection) => void;
  onSelectArtifact: (artifact: Artifact) => void;
  onCloseArtifact: (id: string) => void;
  onEditNode: (artifactId: string, nodeId: string, userText: string) => Promise<void>;
  onPage: (page: number) => void;
  onHistory: () => void;
  onReset: () => void;
}

export default function CopilotResults({
  book, page, chapter, messages, busy, artifacts, openTabs, activeArtifact, section,
  onSection, onSelectArtifact, onCloseArtifact, onEditNode, onPage, onHistory, onReset,
}: Props) {
  const conversation = useRef<HTMLDivElement>(null);
  const activeArtifactId = activeArtifact?.id;
  const isConversation = !activeArtifact && section === 'conversation';
  const libraryKind = section === 'mindmaps' ? 'mindmap' : section === 'knowledge-graphs' ? 'knowledge-graph' : undefined;

  useEffect(() => {
    const container = conversation.current;
    if (!isConversation || !container?.clientHeight) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [messages, isConversation]);

  useEffect(() => {
    const container = conversation.current;
    if (!isConversation || !container) return;
    let wasVisible = container.clientHeight > 0;
    const observer = new ResizeObserver(() => {
      const isVisible = container.clientHeight > 0;
      if (isVisible && !wasVisible) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      }
      wasVisible = isVisible;
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [isConversation]);

  return <aside className="copilot-panel results-panel" aria-label="回答与生成资料" id="course-results">
    <header className="copilot-header">
      <div className="copilot-title"><span className="copilot-symbol"><Sparkles size={19}/></span><span>Copilot <small>回答与生成资料</small></span></div>
      <div className="copilot-header-actions">
        <button type="button" className="icon-button" title="历史对话" aria-label="历史对话" onClick={onHistory} disabled={busy}><History size={17}/></button>
        <button type="button" className="icon-button" title="新建对话" aria-label="新建对话" onClick={onReset} disabled={busy || !messages.length}><Plus size={19}/></button>
      </div>
    </header>

    <div className="result-categories" aria-label="回答与资料分类">
      {categories.map(category => <button type="button" key={category.id} className={`result-category${section === category.id ? ' active' : ''}`} aria-pressed={section === category.id} onClick={() => onSection(category.id)}>
        <category.icon size={15}/>{category.title}
        {category.id !== 'conversation' && <span className="count-badge">{category.kind ? artifacts.filter(artifact => artifact.kind === category.kind).length : artifacts.length}</span>}
      </button>)}
    </div>

    {openTabs.length > 0 && <div className="result-tabs" aria-label="已打开的生成资料">
      {openTabs.map(id => {
        const artifact = artifacts.find(item => item.id === id);
        if (!artifact) return null;
        return <div className={`result-tab${activeArtifactId === id ? ' active' : ''}`} key={id}>
          <button type="button" title={artifact.title} aria-pressed={activeArtifactId === id} onClick={() => onSelectArtifact(artifact)}>{artifact.title}</button>
          <button type="button" aria-label={`关闭${artifact.title}`} onClick={() => onCloseArtifact(id)}><X size={12}/></button>
        </div>;
      })}
    </div>}

    {activeArtifact ? <ArtifactViewer key={activeArtifact.id} artifact={activeArtifact} onPage={onPage} book={book} onEditNode={busy ? undefined : (nodeId, userText) => onEditNode(activeArtifact.id, nodeId, userText)}/>
      : section !== 'conversation' ? <MaterialsLibrary artifacts={artifacts} kind={libraryKind} book={book} onOpen={onSelectArtifact}/>
      : <div className="copilot-scroll" ref={conversation}>
      <div className="context-card"><BookOpen size={15}/><div><span>正在一起阅读</span><strong>{chapter?.title || book.title}</strong></div><span className="context-page">P.{page}</span></div>

      {messages.length === 0 ? <div className="copilot-welcome results-empty">
        <span className="welcome-spark"><Sparkles size={24} strokeWidth={1.5}/></span>
        <h2>回答与资料，都在这里</h2>
        <p>在教材下方选择学习工具并发送要求，<br/>回答与生成资料会显示在这里。</p>
      </div> : <div className="messages" aria-live="polite">{messages.map(message => <article key={message.id} className={`message message-${message.role}`}>
        {message.role === 'assistant' && <div className="message-name"><Sparkles size={14}/> Copilot</div>}
        {message.content && <Markdown book={book}>{message.content}</Markdown>}
        {message.status === 'running' && <div className="message-progress"><LoaderCircle size={14} className="spin"/>{message.progress || '正在处理…'}</div>}
        {(message.status === 'error' || message.status === 'stopped') && <div className="message-error"><AlertCircle size={15}/><span>{message.progress || '暂时无法完成，请稍后重试。'}</span></div>}
        {message.artifacts?.map(artifact => <button type="button" className="artifact-message" key={artifact.id} onClick={() => onSelectArtifact(artifact)}>
          <FileSliders size={18}/><span>{artifact.title}<small>打开生成资料</small></span><ArrowUpRight size={16}/>
        </button>)}
        {message.status === 'done' && !message.content && !message.artifacts?.length && <div className="message-progress"><Check size={14}/>已完成</div>}
      </article>)}</div>}
    </div>}
  </aside>;
}
