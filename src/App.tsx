import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookMarked, BookOpen, Bookmark, Check, ChevronDown, ChevronRight, ChevronsLeft, FileText, FolderOpen, LibraryBig, LoaderCircle, Menu, PanelLeft, Plus, Search, Settings2, Sparkles, Upload, X, CircleHelp, History, AlertCircle } from 'lucide-react';
import type { Artifact, Book, Chapter, ConversationInfo, Message, ReadingState, Scope, SkillId, SkillInfo } from './lib/types';
import { getAgentStatus, getSkills, runSkill, skillsFromStatus, type AgentStatus } from './lib/skill-client';
import { editMindmapNode, getConversation, listConversations, saveBookMetadata, savePageText, uploadBook } from './lib/storage';
import { useCourseWorkspace } from './lib/useCourseWorkspace';
import { getReadingScope } from './lib/reading-scope';
import type { SetStateAction } from 'react';
import TextbookReader from './components/TextbookReader';
import CopilotPanel from './components/CopilotPanel';
import CopilotResults, { type ResultSection } from './components/CopilotResults';
import AgentConnection from './components/AgentConnection';
import { useColumnWidths } from './components/ColumnResizers';

function artifactSection(kind?: Artifact['kind']): ResultSection {
  return kind === 'mindmap' ? 'mindmaps' : kind === 'knowledge-graph' ? 'knowledge-graphs' : 'materials';
}

export default function App() {
  const workspace = useCourseWorkspace();
  const { book, setBook, courses, setCourses, reading, setReading, bootError } = workspace;
  const { page, bookmarks, messages, artifacts } = reading;
  const updateReading = useCallback(<K extends keyof ReadingState>(key: K, value: SetStateAction<ReadingState[K]>) => {
    setReading(current => ({ ...current, [key]: typeof value === 'function' ? (value as (previous: ReadingState[K]) => ReadingState[K])(current[key]) : value }));
  }, [setReading]);
  const setPage = useCallback((value: SetStateAction<number>) => updateReading('page', value), [updateReading]);
  const setMessages = useCallback((value: SetStateAction<Message[]>) => updateReading('messages', value), [updateReading]);
  const setArtifacts = useCallback((value: SetStateAction<Artifact[]>) => updateReading('artifacts', value), [updateReading]);
  const setBookmarks = useCallback((value: SetStateAction<number[]>) => updateReading('bookmarks', value), [updateReading]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [moving, setMoving] = useState(false);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [pageText, setPageText] = useState('');
  const [pageNavigationId, setPageNavigationId] = useState(0);
  const activeReading = useRef({ bookId: book?.id, page });
  activeReading.current = { bookId: book?.id, page };
  const [selectedText, setSelectedText] = useState('');
  const [selectionPages, setSelectionPages] = useState<{ start: number; end: number } | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [resultSection, setResultSection] = useState<ResultSection>('conversation');
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [contextArtifactId, setContextArtifactId] = useState<string | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(() => window.innerWidth > 960);
  const columns = useColumnWidths(outlineOpen, workspace.settings ? workspace.settings.columnWidths || {} : null, widths => { void workspace.savePreferences({ columnWidths: widths }).catch(() => {}); });
  const [outlineMode, setOutlineMode] = useState('chapters');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [mobileView, setMobileView] = useState('reader');
  const [showSettings, setShowSettings] = useState(false);
  const [showBooks, setShowBooks] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ConversationInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState('');
  const controller = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const booksDialog = useRef<HTMLDialogElement>(null);
  const helpDialog = useRef<HTMLDialogElement>(null);
  const historyDialog = useRef<HTMLDialogElement>(null);
  const conversationChanging = useRef(false);

  async function selectBook(next: Book) {
    if (busy || workspace.switching || conversationChanging.current) return;
    if (await workspace.openBook(next)) setShowBooks(false);
  }

  useEffect(() => {
    const abort = new AbortController();
    getSkills(abort.signal).then(setSkills).catch(() => {});
    getAgentStatus(abort.signal).then(setAgentStatus).catch(() => {});
    return () => { abort.abort(); controller.current?.abort(); };
  }, []);
  useEffect(() => {
    setOpenTabs([]); setResultSection('conversation'); setActiveResultId(null); setContextArtifactId(null); setSelectedText(''); setPageText(''); setQuery('');
    setCollapsed(new Set(book?.chapters.filter(item => item.level === 0).slice(1).map(item => item.id) || []));
  }, [book?.id]);
  useEffect(() => { if (!toast) return; const timer=setTimeout(()=>setToast(''),5000); return ()=>clearTimeout(timer); }, [toast]);
  useEffect(() => { if(showSettings) settingsDialog.current?.showModal(); else settingsDialog.current?.close(); },[showSettings]);
  useEffect(() => { if(showBooks) booksDialog.current?.showModal(); else booksDialog.current?.close(); },[showBooks]);
  useEffect(() => { if(showHelp) helpDialog.current?.showModal(); else helpDialog.current?.close(); },[showHelp]);
  useEffect(() => { if(showHistory) historyDialog.current?.showModal(); else historyDialog.current?.close(); },[showHistory]);

  async function newConversation() {
    if (busy || workspace.switching || conversationChanging.current) return;
    conversationChanging.current = true; setMoving(true);
    try {
      await workspace.flush();
      setReading(current => ({ ...current, conversationId: crypto.randomUUID(), messages: [] }));
      setActiveResultId(null); setContextArtifactId(null); setResultSection('conversation');
    } catch (error) { setToast(error instanceof Error ? error.message : '请先保存当前对话。'); }
    finally { conversationChanging.current = false; setMoving(false); }
  }
  async function openHistory() {
    if (!book) return;
    try { await workspace.flush(); setHistory(await listConversations(book.id)); setShowHistory(true); }
    catch(error) { setToast(error instanceof Error ? error.message : '暂时无法读取历史对话。'); }
  }
  async function selectConversation(id: string) {
    if (!book || busy || workspace.switching || conversationChanging.current) return;
    conversationChanging.current = true; setMoving(true);
    try {
      await workspace.flush();
      const saved = await getConversation(book.id, id);
      setReading(current => ({ ...current, conversationId: id, messages: saved.messages }));
      setActiveResultId(null); setContextArtifactId(null); setResultSection('conversation'); setMobileView('copilot');
      setShowHistory(false);
    } catch(error) { setToast(error instanceof Error ? error.message : '暂时无法读取对话。'); }
    finally { conversationChanging.current = false; setMoving(false); }
  }

  const documentReady = useCallback((data: { totalPages: number; chapters: Chapter[] }) => {
    if (!book) return;
    setBook(current => current?.id === book.id ? { ...current, ...data } : current);
    setCourses(current => current.map(item => item.id === book.id ? { ...item, ...data } : item));
    void saveBookMetadata(book.id, data).catch(error => setToast(error.message));
  }, [book?.id, setBook, setCourses]);
  const textReady = useCallback((bookId: string, pageNumber: number, text: string) => {
    if (activeReading.current.bookId !== bookId) return;
    if (activeReading.current.page === pageNumber) setPageText(text);
    if (text) void savePageText(bookId, pageNumber, text).catch(error => setToast(error.message));
  }, []);
  const visiblePageChanged = useCallback((bookId: string, next: number) => {
    if (activeReading.current.bookId !== bookId) return;
    setReading(current => current.page === next ? current : { ...current, page: next });
  }, [setReading]);

  const selectionReady = useCallback((text: string, pages?: { start: number; end: number }) => {
    setSelectedText(text);
    setSelectionPages(text && pages ? pages : null);
  }, []);

  const chapter = useMemo(() => book?.chapters.filter(item=>item.page<=page).at(-1), [book?.chapters,page]);
  const mainChapter = useMemo(() => book?.chapters.filter(item=>item.level===0 && item.page<=page).at(-1), [book?.chapters,page]);
  const activeArtifact = artifacts.find(item=>item.id===activeResultId);
  const contextArtifact = artifacts.find(item=>item.id===contextArtifactId);
  const topChapters = book?.chapters.filter(item=>item.level===0) || [];
  const displayedChapters = useMemo(() => {
    if(!book) return [];
    if(query.trim()) return book.chapters.filter(item=>item.title.toLowerCase().includes(query.toLowerCase()));
    const result:Chapter[]=[];
    let hiddenBelow:number|null=null;
    for(const item of book.chapters) {
      if(hiddenBelow!==null && item.level>hiddenBelow) continue;
      hiddenBelow=null; result.push(item);
      if(collapsed.has(item.id)) hiddenBelow=item.level;
    }
    return result;
  },[book?.chapters,query,collapsed]);

  function goToPage(next:number) {
    if (workspace.switching || moving) return;
    setPage(Math.max(1,Math.min(next,book?.totalPages || next))); setPageNavigationId(value => value + 1); setSelectedText(''); setMobileView('reader');
    if(window.innerWidth<900) setOutlineOpen(false);
  }
  function openArtifact(artifact:Artifact) { setOpenTabs(current=>current.includes(artifact.id)?current:[...current,artifact.id]); setActiveResultId(artifact.id); setResultSection(artifactSection(artifact.kind)); setContextArtifactId(artifact.id); setMobileView('copilot'); }
  function closeTab(id:string) {
    setOpenTabs(current=>current.filter(tab=>tab!==id));
    if(contextArtifactId===id) setContextArtifactId(null);
    if(activeResultId===id) {
      const artifact = artifacts.find(item => item.id === id);
      setActiveResultId(null);
      setResultSection(artifactSection(artifact?.kind));
      setMobileView('copilot');
    }
  }
  function stopTask() { controller.current?.abort(); controller.current=null; setBusy(false); setMessages(current=>current.map(message=>message.status==='running'?{...message,status:'stopped',progress:'已停止。你可以调整要求后重新发送。'}:message)); }
  function clearSelection() { setSelectedText(''); window.getSelection()?.removeAllRanges(); }

  async function editNode(artifactId: string, nodeId: string, userText: string) {
    if (!book) throw new Error('请先打开一本教材。');
    const courseId = book.id;
    const updated = await editMindmapNode(courseId, artifactId, nodeId, userText);
    if (activeReading.current.bookId !== courseId) return;
    setReading(current => ({
      ...current,
      artifacts: current.artifacts.map(item => item.id === updated.id ? updated : item),
      messages: current.messages.map(message => message.artifacts ? {
        ...message, artifacts: message.artifacts.map(item => item.id === updated.id ? updated : item),
      } : message),
    }));
    setToast('补充文字已保存。');
  }

  async function sendSkill(skillId:SkillId,prompt:string,scope:Scope,knowledgeGraphDetail?:'overview'|'detailed') {
    if(!book || busy || workspace.switching || conversationChanging.current) return;
    const quotePages = selectedText ? selectionPages : null;
    const quotedPages = scope === 'selection' ? quotePages : null;
    const requestPage = quotedPages?.start ?? page;
    const readingScope = getReadingScope(book.chapters, requestPage);
    const structureScope = skillId === 'mindmap' || skillId === 'knowledge-graph';
    const requestChapter = structureScope && scope === 'section' ? readingScope.section
      : structureScope && scope === 'chapter' ? readingScope.chapter
      : quotedPages ? book.chapters.filter(item => item.page <= requestPage).at(-1) : chapter;
    const quote = quotePages ? '引用来自 PDF 第 ' + quotePages.start + (quotePages.end === quotePages.start ? '' : '–' + quotePages.end) + ' 页：\n' + selectedText : selectedText;
    const abort=new AbortController(); controller.current=abort; setBusy(true);
    setActiveResultId(null); setResultSection('conversation'); setMobileView('copilot');
    const userId=crypto.randomUUID(), assistantId=crypto.randomUUID();
    setMessages(current=>[...current,{id:userId,role:'user',content:prompt,skillId},{id:assistantId,role:'assistant',content:'',skillId,status:'running',progress:'正在连接 Coding Agent…'}]);
    try {
      await runSkill({skillId,book:{id:book.id,title:book.title,filename:book.filename,totalPages:book.totalPages,local:book.local},chapter:requestChapter,page:requestPage,scope,...(skillId==='knowledge-graph'?{knowledgeGraphDetail:knowledgeGraphDetail||'overview'}:{}),selectedText:quote,pageText:requestPage===page?pageText:'',prompt,artifact:contextArtifact,history:messages.filter(message=>message.status!=='error' && message.status!=='stopped').map(({role,content})=>({role,content}))},event=>{
        if(abort.signal.aborted || controller.current!==abort) return;
        if(event.type==='artifact') {
          const artifact=event.artifact;
          setArtifacts(current=>[...current.filter(item=>item.id!==artifact.id),artifact]); openArtifact(artifact);
        }
        setMessages(current=>current.map(message=>{
          if(message.id!==assistantId) return message;
          if(event.type==='progress') return {...message,progress:event.message};
          if(event.type==='text') return {...message,content:message.content+event.content};
          if(event.type==='artifact') return {...message,artifacts:[...(message.artifacts||[]).filter(item=>item.id!==event.artifact.id),event.artifact]};
          if(event.type==='done') return {...message,status:'done',progress:undefined};
          if(event.type==='error') return {...message,status:'error',progress:event.message};
          return message;
        }));
      },abort.signal);
    } catch(error) {
      if(!abort.signal.aborted && controller.current===abort) setMessages(current=>current.map(message=>message.id===assistantId?{...message,status:'error',progress:error instanceof Error?error.message:'学习工具暂时无法连接。'}:message));
    } finally { if(controller.current===abort) {controller.current=null;setBusy(false);} }
  }

  async function importBook(file?: File) {
    if (!file || importing || busy || workspace.switching || conversationChanging.current) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) { setToast('请选择 PDF 格式的教材。'); return; }
    setImporting(true);
    try {
      await workspace.flush();
      const next = await uploadBook(file);
      setCourses(current => [...current, next]);
      await selectBook(next);
      setToast('教材已保存到个人课程目录。'); setMobileView('reader');
    } catch(error) { setToast(error instanceof Error ? error.message : '教材导入失败，请重试。'); }
    finally { setImporting(false); if(fileInput.current) fileInput.current.value=''; }
  }

  const updateAgentStatus = useCallback((status: AgentStatus) => { setAgentStatus(status); setSkills(skillsFromStatus(status)); }, []);

  return <div className="app-shell">
    <header className="app-header">
      <button className="brand" onClick={()=>setShowBooks(true)} aria-label="打开课程书架"><span className="brand-mark"><LibraryBig size={23} strokeWidth={1.65}/></span><span className="brand-name">知页<span>COURSE COPILOT</span></span></button>
      <div className="header-divider"/>
      <button className="current-course" onClick={()=>setShowBooks(true)}><BookOpen size={16}/><span>{book?.title || '我的课程'}</span><ChevronDown size={14}/></button>
      <div className="header-actions"><span className="workspace-label"><span className={`status-dot ${workspace.saveError ? '' : 'online'}`}/>{workspace.saveError ? '未保存' : workspace.pending ? '正在保存…' : '已保存到本机'}</span><button className="text-button import-button" disabled={importing || busy || workspace.switching || moving} onClick={()=>fileInput.current?.click()}><Upload size={15}/><span>{importing ? '正在导入…' : '导入教材'}</span></button><button className="icon-button settings-button" title="工作区设置" aria-label="工作区设置" onClick={()=>setShowSettings(true)}><Settings2 size={19}/></button><span className="user-avatar" title="本地学习空间">我</span></div>
      <input ref={fileInput} type="file" accept="application/pdf,.pdf" hidden onChange={event=>void importBook(event.target.files?.[0])}/>
    </header>

    {(workspace.saveError || workspace.warnings.length > 0) && <div className="storage-warning" role="alert"><AlertCircle size={16}/><span>{workspace.saveError || workspace.warnings.join(' ')}</span>{workspace.saveError && <button onClick={() => void workspace.flush().catch(() => {})}>重试保存</button>}</div>}
    <nav className="mobile-tabs" aria-label="切换工作区域"><button className={mobileView==='reader'?'active':''} onClick={()=>setMobileView('reader')}><BookOpen size={16}/>教材与提问</button><button className={mobileView==='copilot'?'active':''} onClick={()=>setMobileView('copilot')}><Sparkles size={16}/>回答与资料</button></nav>

    <div ref={columns.workspaceRef} style={columns.style} inert={workspace.switching || moving} aria-busy={workspace.switching || moving} className={`workspace ${outlineOpen?'':'outline-closed'} mobile-${mobileView} ${columns.dragging ? 'is-resizing' : ''}`}>
      {columns.resizers}
      {outlineOpen && <div className="outline-scrim" onClick={()=>setOutlineOpen(false)}/>}
      <aside id="course-outline" className="outline-panel" aria-label="教材目录">
        <div className="outline-heading"><span>课程导航</span><button className="icon-button" onClick={()=>setOutlineOpen(false)} aria-label="收起目录"><ChevronsLeft size={17}/></button></div>
        <div className="outline-switch"><button className={outlineMode==='chapters'?'active':''} onClick={()=>setOutlineMode('chapters')}><Menu size={14}/>目录</button><button className={outlineMode==='bookmarks'?'active':''} onClick={()=>setOutlineMode('bookmarks')}><Bookmark size={13}/>书签{bookmarks.length>0 && <small>{bookmarks.length}</small>}</button></div>
        <label className="chapter-search"><Search size={14}/><input placeholder="搜索章节…" aria-label="搜索章节" value={query} onChange={event=>setQuery(event.target.value)}/>{query && <button className="icon-button" aria-label="清除章节搜索" onClick={()=>setQuery('')}><X size={12}/></button>}</label>
        <div className="chapter-list">
          {outlineMode==='chapters' ? displayedChapters.map((item)=>{
            const originalIndex=book!.chapters.findIndex(row=>row.id===item.id);
            const hasChildren=book!.chapters[originalIndex+1]?.level>item.level;
            const isActive=chapter?.id===item.id || (collapsed.has(item.id)&&mainChapter?.id===item.id);
            return <div key={item.id} className={`chapter-row level-${Math.min(item.level,2)} ${isActive?'active':''}`}>
              {hasChildren ? <button className="chapter-toggle" aria-label={`${collapsed.has(item.id)?'展开':'收起'}${item.title}`} onClick={()=>setCollapsed(current=>{const next=new Set(current);next.has(item.id)?next.delete(item.id):next.add(item.id);return next;})}><ChevronRight size={12} className={collapsed.has(item.id)?'':'expanded'}/></button> : <span className="chapter-toggle-spacer"/>}
              <button className="chapter-link" onClick={()=>goToPage(item.page)} title={item.title}>{item.level===0 && <span className="chapter-index">{String(topChapters.findIndex(ch=>ch.id===item.id)+1).padStart(2,'0')}</span>}<span>{item.title}</span><small>{item.page}</small></button>
            </div>;
          }) : [...bookmarks].sort((a,b)=>a-b).filter(number=>!query || String(number).includes(query)).map(number=><button className={`bookmark-row ${number===page?'active':''}`} key={number} onClick={()=>goToPage(number)}><Bookmark size={14}/><span>第 {number} 页</span><ChevronRight size={13}/></button>)}
          {outlineMode==='chapters' && !displayedChapters.length && <p className="outline-empty">{query?'没有找到相关章节':'这本 PDF 暂无内置目录，可使用页码翻阅。'}</p>}
          {outlineMode==='bookmarks' && !bookmarks.length && <p className="outline-empty">点击教材右上方的书签图标，收藏想要回看的页面。</p>}
        </div>
        <div className="outline-bottom"><span className="book-format"><FileText size={15}/><span>PDF 教材<small>{book?.totalPages ? `${book.totalPages} 页 · 原文阅读`:'正在载入'}</small></span></span><button className="icon-button" onClick={()=>setShowHelp(true)} aria-label="使用帮助"><CircleHelp size={16}/></button></div>
      </aside>

      <main id="course-reading" className="reading-panel">
        <div className="reading-location textbook-heading">
          <button className="icon-button outline-open-button" aria-label="展开教材目录" onClick={()=>setOutlineOpen(!outlineOpen)}><PanelLeft size={17}/></button>
          {book && <><span>{mainChapter ? `第 ${topChapters.findIndex(item=>item.id===mainChapter.id)+1} 章`:'教材'}</span><ChevronRight size={12}/><strong>{chapter?.title || book.title}</strong></>}
          <span className="original-label">教材原文</span>
          <button className={`icon-button bookmark-button ${bookmarks.includes(page)?'marked':''}`} disabled={!book} onClick={()=>{setBookmarks(current=>current.includes(page)?current.filter(number=>number!==page):[...current,page]);setToast(bookmarks.includes(page)?'已移除书签。':`已收藏第 ${page} 页。`);}} aria-label={bookmarks.includes(page)?'移除本页书签':'收藏本页'} title={bookmarks.includes(page)?'移除本页书签':'收藏本页'}><Bookmark size={17} fill={bookmarks.includes(page)?'currentColor':'none'}/></button>
        </div>
        <div className="reading-content">{book ? <div className="reader-mount"><TextbookReader book={book} page={page} navigationId={pageNavigationId} onPageChange={goToPage} onVisiblePageChange={visiblePageChanged} onDocumentReady={documentReady} onTextChange={textReady} onSelectionChange={selectionReady}/></div>
          : <div className="boot-state">{bootError ? <><BookOpen size={36}/><h2>先打开一本教材</h2><p>{bootError}</p><button className="primary-button" onClick={()=>fileInput.current?.click()}><Upload size={16}/>导入 PDF</button></> : <><LoaderCircle className="spin" size={28}/><p>正在准备你的课程空间…</p></>}</div>}</div>
        {book && <CopilotPanel book={book} page={page} chapter={chapter} selectedText={selectedText} onClearSelection={clearSelection} contextArtifact={contextArtifact} onClearArtifact={()=>setContextArtifactId(null)} skills={skills} busy={busy || workspace.switching || moving} onSend={sendSkill} onStop={stopTask} onSettings={()=>setShowSettings(true)}/>}
      </main>

      {book && <CopilotResults book={book} page={page} chapter={chapter} messages={messages} busy={busy || workspace.switching || moving} artifacts={artifacts} openTabs={openTabs} activeArtifact={activeArtifact} section={resultSection} onSection={section=>{setResultSection(section); setActiveResultId(null); setMobileView('copilot');}} onSelectArtifact={openArtifact} onCloseArtifact={closeTab} onEditNode={editNode} onPage={goToPage} onHistory={()=>void openHistory()} onReset={()=>void newConversation()}/>}
    </div>

    <dialog className="settings-dialog" ref={settingsDialog} onCancel={()=>setShowSettings(false)} onClick={event=>{if(event.target===event.currentTarget)setShowSettings(false);}}>
      <div className="dialog-title"><span><Settings2 size={19}/>工作区设置</span><button className="icon-button" onClick={()=>setShowSettings(false)} aria-label="关闭工作区设置"><X size={19}/></button></div>
      <div className="dialog-body"><span className="eyebrow">YOUR COURSE ASSISTANT</span><h2>连接你的课程助手</h2>
        <p className="dialog-intro">接上本机 Agent，让它陪你读教材、回答问题、制作学习资料。</p>
        <AgentConnection status={agentStatus} active={showSettings} busy={busy} onChange={updateAgentStatus}/>
        <section className="storage-location"><h3><FolderOpen size={17}/>个人数据目录</h3><code>{workspace.directory || '正在读取保存位置…'}</code><p>教材、阅读记录、对话和生成资料保存在这里。连接设置也保存在这个文件夹里。</p></section>
      </div>
    </dialog>

    <dialog className="books-dialog" ref={booksDialog} onCancel={()=>setShowBooks(false)} onClick={event=>{if(event.target===event.currentTarget)setShowBooks(false);}}><div className="dialog-title"><span><LibraryBig size={19}/>我的教材</span><button className="icon-button" onClick={()=>setShowBooks(false)} aria-label="关闭教材书架"><X size={19}/></button></div><div className="dialog-body"><h2>从一本书开始</h2><p className="dialog-intro">切换教材时，阅读位置、对话和学习资料会分别保留。</p>{courses.map(item=><button key={item.id} className={`book-option ${book?.id===item.id?'active':''}`} disabled={busy || workspace.switching || moving} onClick={()=>void selectBook(item)}><span className="book-option-icon"><BookMarked size={25}/></span><span><strong>{item.title}</strong><small>{item.source === 'imported' ? '已导入' : '课程教材'} · 保存在个人目录{item.totalPages?` · ${item.totalPages} 页`:''}</small></span>{book?.id===item.id?<Check size={18}/>:<ChevronRight size={18}/>}</button>)}<button className="import-dropzone" disabled={importing || busy || moving} onClick={()=>fileInput.current?.click()}><Plus size={22}/><strong>导入另一本教材</strong><span>PDF 格式，最大 100 MB · 各本教材分别保存</span></button></div></dialog>

    <dialog className="help-dialog" ref={helpDialog} onCancel={()=>setShowHelp(false)} onClick={event=>{if(event.target===event.currentTarget)setShowHelp(false);}}><div className="dialog-title"><span><CircleHelp size={19}/>开始使用</span><button className="icon-button" onClick={()=>setShowHelp(false)} aria-label="关闭使用帮助"><X size={19}/></button></div><div className="dialog-body help-content"><h2>左侧阅读与提问，右侧查看结果</h2><p><strong>阅读教材</strong>通过目录或页码跳转，缩放查看公式，点击书签保存位置。当前显示的是原始 PDF。</p><p><strong>带着内容提问</strong>鼠标选中教材文字，教材下方的输入框会带上引用。在下方横排课程工具中选择功能，填写要求后发送。</p><p><strong>查看学习资料</strong>接入 Skill 后，生成的图谱、课件和视频会在右侧结果区打开，也会保存在右侧的“学习资料”及对应分类里。</p><p className="help-note">教材、阅读记录、对话和学习资料保存在个人课程文件夹中。当前 Coding Agent 尚待连接，连接并配置 Skill 后才能生成内容。</p></div></dialog>
    <dialog className="history-dialog" ref={historyDialog} onCancel={()=>setShowHistory(false)} onClick={event=>{if(event.target===event.currentTarget)setShowHistory(false);}}><div className="dialog-title"><span><History size={19}/>历史对话</span><button className="icon-button" onClick={()=>setShowHistory(false)} aria-label="关闭历史对话"><X size={19}/></button></div><div className="dialog-body"><p className="dialog-intro">当前教材的对话保存在课程文件夹中，新建对话会保留之前的记录。</p>{history.filter(item=>item.messageCount>0).map(item=><button className="conversation-option" key={item.id} disabled={busy || moving} onClick={()=>void selectConversation(item.id)}><span><strong>{item.title}</strong><small>{item.messageCount} 条消息 · {new Date(item.updatedAt).toLocaleString('zh-CN')}</small></span>{item.id===reading.conversationId ? <Check size={17}/> : <ChevronRight size={17}/>}</button>)}{!history.some(item=>item.messageCount>0) && <p className="outline-empty">还没有历史对话，开始提问后会自动保存。</p>}</div></dialog>
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}</div>}
  </div>;
}
