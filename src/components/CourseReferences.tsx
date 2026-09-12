import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, ExternalLink, FileText, LoaderCircle, Pencil, RefreshCw, Trash2, Upload } from 'lucide-react';
import { deleteReference, listReferences, updateReference, uploadReference } from '../lib/storage';
import type { Book, CourseReference } from '../lib/types';
import './course-references.css';

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} 字节`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
const message = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';

export default function CourseReferences({ book, busy, onWorkingChange }: {
  book: Book; busy: boolean; onWorkingChange: (working: boolean) => void;
}) {
  const [items, setItems] = useState<CourseReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const operation = useRef(false);
  const disabled = busy || working || loading;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    listReferences(book.id, controller.signal).then(setItems).catch(error => {
      if (!controller.signal.aborted) setError(message(error));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [book.id, refresh]);

  function begin() {
    if (disabled || operation.current) return false;
    operation.current = true; setWorking(true); onWorkingChange(true); setError(''); setNotice('');
    return true;
  }
  function finish() { operation.current = false; setWorking(false); onWorkingChange(false); }

  async function upload(files: File[]) {
    if (!files.length || !begin()) return;
    const failures: string[] = [];
    let saved = 0;
    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        setNotice(`正在上传 ${index + 1}/${files.length}：${file.name}`);
        try {
          const reference = await uploadReference(book.id, file);
          setItems(current => [...current, reference]); saved++;
        } catch (error) { failures.push(`${file.name}：${message(error)}`); }
      }
      setNotice(`已添加 ${saved} 份辅助资料。`);
      setError(failures.join('\n'));
    } finally { finish(); if (input.current) input.current.value = ''; }
  }

  async function save(id: string) {
    if (!begin()) return;
    try {
      const updated = await updateReference(book.id, id, { title, description });
      setItems(current => current.map(item => item.id === id ? updated : item));
      setEditing(null); setNotice('资料说明已保存。');
    } catch (error) { setError(message(error)); }
    finally { finish(); }
  }
  async function remove(id: string) {
    if (!begin()) return;
    try {
      await deleteReference(book.id, id);
      setItems(current => current.filter(item => item.id !== id));
      setDeleting(null); setNotice('辅助资料已删除。');
    } catch (error) { setError(message(error)); }
    finally { finish(); }
  }

  return <section className="course-references" aria-label="辅助资料">
    <div className="references-heading"><div><h1>辅助资料</h1><p>为《{book.title}》添加讲义、习题解答和参考文献。课程助手会按问题选读相关内容。</p></div>
      <button className="primary-button" disabled={disabled} onClick={() => input.current?.click()}>{working ? <LoaderCircle size={16} className="spin"/> : <Upload size={16}/>}添加资料</button>
      <input ref={input} type="file" multiple hidden accept=".pdf,.txt,.md,.docx,.pptx,.png,.jpg,.jpeg,.webp" onChange={event => void upload(Array.from(event.target.files || []))}/>
    </div>
    <p className="references-formats">支持 PDF、TXT、Markdown、DOCX、PPTX、PNG、JPEG、WebP。每份最大 100 MiB（104857600 字节），可一次选择多份。</p>
    {error && <div className="references-error" role="alert"><AlertCircle size={17}/><span>{error}</span></div>}
    {notice && <p className="references-notice" role="status">{notice}</p>}
    <div className="references-summary"><span>{loading ? '正在读取资料…' : `${items.length} 份资料`}</span><button className="text-button" disabled={disabled} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14}/>刷新</button></div>
    {!loading && !items.length && !error && <div className="references-empty"><FileText size={32}/><h2>收好课程的参考材料</h2><p>添加老师的讲义、补充阅读或习题解答，并用说明标记章节和用途。</p></div>}
    <div className="references-list">{items.map(item => <article className="reference-card" key={item.id}>
      <div className="reference-details"><span className="reference-format">{item.format.toUpperCase()}</span><h2>{item.title}</h2><p className="reference-meta">{item.filename} · {fileSize(item.size)} · {new Date(item.createdAt).toLocaleDateString('zh-CN')}</p>
        {item.description && <p className="reference-description">{item.description}</p>}
      </div>
      {editing === item.id ? <form className="reference-edit" onSubmit={event => { event.preventDefault(); void save(item.id); }}>
        <label>资料名称<input value={title} required maxLength={200} disabled={disabled} onChange={event => setTitle(event.target.value)}/></label>
        <label>说明<textarea value={description} maxLength={2000} rows={3} placeholder="例如：第三章习题解答，包含梯度下降的收敛证明。" disabled={disabled} onChange={event => setDescription(event.target.value)}/></label>
        <div className="reference-actions"><button className="primary-button" disabled={disabled || !title.trim()} type="submit"><Check size={14}/>保存</button><button className="text-button" disabled={disabled} type="button" onClick={() => setEditing(null)}>取消</button></div>
      </form> : <div className="reference-actions">
        <a className="text-button" href={item.url} target="_blank" rel="noreferrer"><ExternalLink size={14}/>打开资料</a>
        <button className="text-button" disabled={disabled} onClick={() => { setEditing(item.id); setTitle(item.title); setDescription(item.description); setDeleting(null); }}><Pencil size={14}/>编辑说明</button>
        <button className="text-button reference-delete" disabled={disabled} onClick={() => setDeleting(item.id)}><Trash2 size={14}/>删除</button>
      </div>}
      {deleting === item.id && <div className="reference-confirm"><span>删除《{item.title}》及其原文件？</span><button className="text-button reference-delete" disabled={disabled} onClick={() => void remove(item.id)}>确认删除</button><button className="text-button" disabled={disabled} onClick={() => setDeleting(null)}>取消</button></div>}
    </article>)}</div>
  </section>;
}
