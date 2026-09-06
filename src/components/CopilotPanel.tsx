import { useEffect, useRef, useState } from 'react';
import { ArrowUp, BookOpen, Check, ChevronDown, CornerDownLeft, FileSliders, MessageCircle, Network, Plus, Quote, Sparkles, Square, Video, Waypoints, X, LoaderCircle, ArrowUpRight, AlertCircle, History } from 'lucide-react';
import type { Artifact, Book, Chapter, Message, Scope, SkillId, SkillInfo } from '../lib/types';
import Markdown from './Markdown';

const tools = [
  { id: 'explain', title: '讲解内容', subtitle: '把难点讲明白', icon: BookOpen, prompt: '请讲解当前内容，先给出直观理解，再展开关键步骤。' },
  { id: 'mindmap', title: '思维导图', subtitle: '梳理章节脉络', icon: Waypoints, prompt: '请将当前内容整理为层次清晰的思维导图。' },
  { id: 'knowledge-graph', title: '知识图谱', subtitle: '发现知识间的联系', icon: Network, prompt: '请梳理当前内容中的知识点，以及它们之间的关系。' },
  { id: 'slides', title: '生成课件', subtitle: '把知识变成课件', icon: FileSliders, prompt: '请根据当前内容生成适合课堂讲解的课件。' },
  { id: 'video', title: '讲解视频', subtitle: '跟着讲解学一遍', icon: Video, prompt: '请为当前内容生成讲解视频。' },
  { id: 'chat', title: '自由问答', subtitle: '聊聊你的疑问', icon: MessageCircle, prompt: '' },
] as const;

interface Props {
  book: Book; page: number; chapter?: Chapter; selectedText: string; onClearSelection: () => void;
  skills: SkillInfo[]; messages: Message[]; busy: boolean; onSend: (id: SkillId, prompt: string, scope: Scope) => void;
  onStop: () => void; onReset: () => void; onHistory: () => void; onArtifact: (artifact: Artifact) => void; onSettings: () => void;
}

export default function CopilotPanel(props: Props) {
  const { book, page, chapter, selectedText, skills, messages, busy } = props;
  const [activeSkill, setActiveSkill] = useState<SkillId>('chat');
  const [prompt, setPrompt] = useState('');
  const [scope, setScope] = useState<Scope>('page');
  const [toolsOpen, setToolsOpen] = useState(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const selectedInfo = skills.find(skill => skill.id === activeSkill);
  const activeTitle = tools.find(tool => tool.id === activeSkill)?.title;
  const connectedCount = skills.filter(skill => skill.available).length;

  useEffect(() => { if (selectedText) setScope('selection'); else setScope(current => current === 'selection' ? 'page' : current); }, [selectedText]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [messages]);
  useEffect(() => { setPrompt(''); setScope('page'); setActiveSkill('chat'); }, [book.id]);

  function submit() {
    if (!prompt.trim() || busy || (scope === 'selection' && !selectedText)) return;
    props.onSend(activeSkill, prompt.trim(), scope);
    setPrompt('');
    setToolsOpen(false);
  }

  return <aside className="copilot-panel" aria-label="课程 Copilot">
    <header className="copilot-header">
      <div className="copilot-title"><span className="copilot-symbol"><Sparkles size={19}/></span><span>Copilot <small>课程学习助手</small></span></div>
      <div className="copilot-header-actions"><button className="icon-button" title="历史对话" aria-label="历史对话" onClick={props.onHistory} disabled={busy}><History size={17}/></button><button className="icon-button" title="新建对话" aria-label="新建对话" onClick={props.onReset} disabled={busy || !messages.length}><Plus size={19}/></button></div>
    </header>

    <div className="copilot-scroll">
      <div className="context-card"><BookOpen size={15}/><div><span>正在一起阅读</span><strong>{chapter?.title || book.title}</strong></div><span className="context-page">P.{page}</span></div>

      <section className="tool-section">
        <button className="section-label tool-heading" onClick={() => setToolsOpen(!toolsOpen)} aria-expanded={toolsOpen}><span>课程工具 <small>SKILLS</small></span><ChevronDown size={15} className={toolsOpen ? '' : 'rotated'}/></button>
        {toolsOpen && <div className="skill-grid">{tools.map(tool => <button key={tool.id} className={`skill-tile ${activeSkill === tool.id ? 'selected' : ''}`} onClick={() => { setActiveSkill(tool.id); setPrompt(tool.prompt); input.current?.focus(); }} title={skills.find(item => item.id === tool.id)?.available ? tool.subtitle : `${tool.title}尚待接入，可以先填写要求`}>
          <span className={`tool-icon tool-${tool.id}`}><tool.icon size={18}/></span><span className="tool-copy"><strong>{tool.title}</strong><small>{tool.subtitle}</small></span>
          {!skills.find(item => item.id === tool.id)?.available && <span className="pending-dot" aria-label="待接入"/>}
        </button>)}</div>}
      </section>

      {messages.length === 0 ? <div className="copilot-welcome">
        <span className="welcome-spark"><Sparkles size={24} strokeWidth={1.5}/></span>
        <h2>带着问题，读懂这一页</h2>
        <p>选择一个学习工具，或选中教材中的内容，<br/>把你的疑问留在这里。</p>
        <div className="starter-prompts">
          <button onClick={() => { setActiveSkill('explain'); setPrompt('这部分内容的核心思想是什么？请用一个直观的例子解释。'); input.current?.focus(); }}>这部分的核心思想是什么？<ArrowUpRight size={15}/></button>
          <button onClick={() => { setActiveSkill('chat'); setPrompt('学习当前内容前，需要先掌握哪些知识？'); input.current?.focus(); }}>我需要先掌握哪些知识？<ArrowUpRight size={15}/></button>
        </div>
      </div> : <div className="messages" aria-live="polite">{messages.map(message => <article key={message.id} className={`message message-${message.role}`}>
        {message.role === 'assistant' && <div className="message-name"><Sparkles size={14}/> Copilot</div>}
        {message.content && <Markdown book={book}>{message.content}</Markdown>}
        {message.status === 'running' && <div className="message-progress"><LoaderCircle size={14} className="spin"/>{message.progress || '正在处理…'}</div>}
        {(message.status === 'error' || message.status === 'stopped') && <div className="message-error"><AlertCircle size={15}/><span>{message.progress || '暂时无法完成，请稍后重试。'}</span></div>}
        {message.artifacts?.map(artifact => <button className="artifact-message" key={artifact.id} onClick={() => props.onArtifact(artifact)}><FileSliders size={18}/><span>{artifact.title}<small>点击在左侧查看</small></span><ArrowUpRight size={16}/></button>)}
        {message.status === 'done' && !message.content && !message.artifacts?.length && <div className="message-progress"><Check size={14}/>已完成</div>}
      </article>)}<div ref={bottom}/></div>}
    </div>

    <div className="composer-area">
      {selectedText && <div className="selection-context"><Quote size={14}/><span>{selectedText}</span><button className="icon-button" onClick={props.onClearSelection} aria-label="清除选中内容"><X size={14}/></button></div>}
      <div className="composer">
        <div className="composer-options"><span className="active-skill"><Sparkles size={12}/>{activeTitle}</span><label className="scope-picker"><select aria-label="操作范围" value={scope} onChange={event => setScope(event.target.value as Scope)}><option value="page">当前页</option><option value="chapter">当前章节</option><option value="book">整本教材</option><option value="selection" disabled={!selectedText}>选中内容</option></select><ChevronDown size={12}/></label></div>
        <textarea ref={input} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={activeSkill === 'chat' ? '关于这本教材，你想了解什么？' : '补充你的要求…'} aria-label="向 Copilot 输入要求" rows={3} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }}/>
        <div className="composer-bottom"><span><CornerDownLeft size={12}/> 发送 <i>·</i> Shift + Enter 换行</span>{busy ? <button className="send-button" onClick={props.onStop} aria-label="停止任务"><Square size={15} fill="currentColor"/></button> : <button className="send-button" onClick={submit} disabled={!prompt.trim()} aria-label="发送要求" title={selectedInfo?.available ? '发送要求' : '此功能尚待接入'}><ArrowUp size={19}/></button>}</div>
      </div>
      <button className="connection-note" onClick={props.onSettings}><span className={`status-dot ${connectedCount ? 'online' : ''}`}/>{connectedCount ? `${connectedCount} 个工具已连接` : '学习工具待接入'}<span>查看连接<ArrowUpRight size={11}/></span></button>
    </div>
  </aside>;
}
