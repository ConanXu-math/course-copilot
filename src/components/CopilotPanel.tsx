import { useEffect, useRef, useState } from 'react';
import { ArrowUp, BookOpen, ChevronDown, CornerDownLeft, FileSliders, MessageCircle, Network, Quote, Sparkles, Square, Video, Waypoints, X, ArrowUpRight } from 'lucide-react';
import type { Artifact, Book, Chapter, KnowledgeGraphDetail, Scope, SkillId, SkillInfo } from '../lib/types';

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
  contextArtifact?: Artifact; onClearArtifact: () => void;
  skills: SkillInfo[]; busy: boolean; onSend: (id: SkillId, prompt: string, scope: Scope, knowledgeGraphDetail?: KnowledgeGraphDetail) => void;
  onStop: () => void; onSettings: () => void;
}

export default function CopilotPanel(props: Props) {
  const { book, selectedText, contextArtifact, skills, busy } = props;
  const [activeSkill, setActiveSkill] = useState<SkillId>('chat');
  const [prompt, setPrompt] = useState('');
  const [scope, setScope] = useState<Scope>('page');
  const [knowledgeGraphDetail, setKnowledgeGraphDetail] = useState<KnowledgeGraphDetail>('overview');
  const input = useRef<HTMLTextAreaElement>(null);
  const selectedInfo = skills.find(skill => skill.id === activeSkill);
  const activeTitle = tools.find(tool => tool.id === activeSkill)?.title;
  const connectedCount = skills.filter(skill => skill.available).length;
  const structureScope = activeSkill === 'mindmap' || activeSkill === 'knowledge-graph';
  const currentScope = structureScope && scope === 'page' ? 'section'
    : !structureScope && scope === 'section' ? 'page' : scope;

  useEffect(() => { if (selectedText) setScope('selection'); else setScope(current => current === 'selection' ? 'page' : current); }, [selectedText]);
  useEffect(() => { setPrompt(''); setScope('page'); setActiveSkill('chat'); setKnowledgeGraphDetail('overview'); }, [book.id]);

  function submit() {
    if (!prompt.trim() || busy || (currentScope === 'selection' && !selectedText)) return;
    props.onSend(activeSkill, prompt.trim(), currentScope, activeSkill === 'knowledge-graph' ? knowledgeGraphDetail : undefined);
    setPrompt('');
  }

  return <section className="course-composer" aria-label="课程工具与输入">
    <section className="tool-section" aria-label="课程工具">
      <div className="section-label tool-heading"><span>课程工具 <small>SKILLS</small></span></div>
      <div className="skill-grid">{tools.map(tool => <button key={tool.id} className={`skill-tile ${activeSkill === tool.id ? 'selected' : ''}`} aria-pressed={activeSkill === tool.id} onClick={() => { setActiveSkill(tool.id); setPrompt(tool.prompt); input.current?.focus(); }} title={skills.find(item => item.id === tool.id)?.available ? tool.subtitle : `${tool.title}尚待接入，可以先填写要求`}>
        <span className={`tool-icon tool-${tool.id}`}><tool.icon size={18}/></span><span className="tool-copy"><strong>{tool.title}</strong></span>
        {!skills.find(item => item.id === tool.id)?.available && <span className="pending-dot" aria-label="待接入"/>}
      </button>)}</div>
    </section>

    <div className="composer-area">
      {contextArtifact && <div className="selection-context artifact-context"><FileSliders size={14}/><span title={contextArtifact.title}>正在讨论：{contextArtifact.title}</span><button className="icon-button" onClick={props.onClearArtifact} aria-label="清除资料上下文"><X size={14}/></button></div>}
      {selectedText && <div className="selection-context"><Quote size={14}/><span>{selectedText}</span><button className="icon-button" onClick={props.onClearSelection} aria-label="清除选中内容"><X size={14}/></button></div>}
      <div className="composer">
        <div className="composer-options"><span className="active-skill"><Sparkles size={12}/>{activeTitle}</span>{activeSkill === 'knowledge-graph' && <label className="scope-picker knowledge-detail-picker" title="概览突出核心关系；详细展开范围内的概念与关系，并记录覆盖情况。"><select aria-label="知识图谱详细程度" value={knowledgeGraphDetail} onChange={event => setKnowledgeGraphDetail(event.target.value as KnowledgeGraphDetail)}><option value="overview">概览</option><option value="detailed">详细</option></select><ChevronDown size={12}/></label>}<label className="scope-picker"><select aria-label="操作范围" value={currentScope} onChange={event => setScope(event.target.value as Scope)}>
          {structureScope ? <><option value="section">当前节</option><option value="chapter">当前章</option></> : <><option value="page">当前页</option><option value="chapter">当前章节</option></>}
          <option value="book">整本教材</option><option value="selection" disabled={!selectedText}>选中内容</option>
        </select><ChevronDown size={12}/></label></div>
        <textarea ref={input} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={activeSkill === 'chat' ? '关于这本教材，你想了解什么？' : '补充你的要求…'} aria-label="向 Copilot 输入要求" rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }}/>
        <div className="composer-bottom"><span><CornerDownLeft size={12}/> 发送 <i>·</i> Shift + Enter 换行</span>{busy ? <button className="send-button" onClick={props.onStop} aria-label="停止任务"><Square size={15} fill="currentColor"/></button> : <button className="send-button" onClick={submit} disabled={!prompt.trim()} aria-label="发送要求" title={selectedInfo?.available ? '发送要求' : '此功能尚待接入'}><ArrowUp size={19}/></button>}</div>
      </div>
      <button className="connection-note" onClick={props.onSettings}><span className={`status-dot ${connectedCount ? 'online' : ''}`}/>{connectedCount ? `${connectedCount} 个工具已连接` : '学习工具待接入'}<span>查看连接<ArrowUpRight size={11}/></span></button>
    </div>
  </section>;
}
