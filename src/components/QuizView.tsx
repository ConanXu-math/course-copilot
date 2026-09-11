import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Lightbulb, MessageCircle, RotateCcw } from 'lucide-react';
import type { Artifact, Book, QuizQuestion } from '../lib/types';
import Markdown from './Markdown';
import './quiz.css';

export type QuizAction = (question: QuizQuestion, answer: string, action: 'feedback' | 'variation') => void;
type Draft = { answer: string; hints: number; revealed: boolean; sent: boolean };
const emptyDraft: Draft = { answer: '', hints: 0, revealed: false, sent: false };

export default function QuizView({ artifact, book, onPage, onAction }: {
  artifact: Extract<Artifact, { kind: 'quiz' }>;
  book?: Book;
  onPage: (page: number) => void;
  onAction?: QuizAction;
}) {
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const question = artifact.questions[index];
  if (!question) return <div className="artifact-empty">这份练习还没有题目。</div>;
  const draft = drafts[question.id] || emptyDraft;
  const hints = question.hints || [];
  const hasSolution = Boolean(question.answer?.trim() || question.explanation?.trim());
  function update(patch: Partial<Draft>) {
    setDrafts(current => ({ ...current, [question.id]: { ...(current[question.id] || emptyDraft), ...patch } }));
  }
  function navigate(next: number) {
    setIndex(next);
    requestAnimationFrame(() => { heading.current?.focus(); heading.current?.scrollIntoView({ block: 'nearest' }); });
  }
  return <div className="quiz-view">
    <div className="quiz-overview"><span>知识点自测</span><span aria-live="polite">第 {index + 1} / {artifact.questions.length} 题</span></div>
    <nav className="quiz-navigation" aria-label="选择练习题">
      {artifact.questions.map((item, position) => <button key={item.id} aria-label={`第 ${position + 1} 题`} aria-current={position === index ? 'step' : undefined} onClick={() => navigate(position)}>{position + 1}{drafts[item.id]?.answer.trim() && <span className="quiz-draft-dot" aria-label="已填写作答"/>}</button>)}
    </nav>
    <article className="quiz-card">
      <div className="quiz-meta"><span>{question.knowledgePoint || '知识点练习'}</span>{question.difficulty && <span>{question.difficulty}</span>}{question.page && <button className="text-button" onClick={() => onPage(question.page!)}><BookOpen size={14}/>PDF 第 {question.page} 页</button>}</div>
      <h2 ref={heading} tabIndex={-1}>练习 {String(index + 1).padStart(2, '0')}</h2>
      <Markdown book={book}>{question.prompt}</Markdown>
      <div className="quiz-answer"><label htmlFor={`quiz-answer-${artifact.id}`}>我的作答</label><textarea id={`quiz-answer-${artifact.id}`} rows={5} value={draft.answer} placeholder="写下答案和思路，支持输入 LaTeX 公式…" onChange={event => update({ answer: event.target.value, sent: false })}/>
        {draft.answer.trim() && <details className="quiz-preview"><summary>预览作答中的公式</summary><Markdown book={book}>{draft.answer}</Markdown></details>}
      </div>
      {draft.hints > 0 && <div className="quiz-hints" aria-live="polite">{hints.slice(0, draft.hints).map((hint, position) => <div key={position}><span>提示 {position + 1}</span><Markdown book={book}>{hint}</Markdown></div>)}</div>}
      <div className="quiz-actions">
        <button className="primary-button" disabled={!onAction || !draft.answer.trim()} onClick={() => { onAction?.(question, draft.answer, 'feedback'); update({ sent: true }); }}><MessageCircle size={16}/>请 Copilot 反馈</button>
        {hints.length > 0 && <button className="text-button" disabled={draft.hints >= hints.length} onClick={() => update({ hints: draft.hints + 1 })}><Lightbulb size={16}/>{draft.hints >= hints.length ? '提示已全部展开' : draft.hints ? '再给一点提示' : '给一点提示'}</button>}
        {hasSolution && <button className="text-button" aria-expanded={draft.revealed} onClick={() => update({ revealed: !draft.revealed })}>{draft.revealed ? '收起答案与解析' : '查看答案与解析'}</button>}
      </div>
      {draft.sent && <p className="quiz-notice" role="status">已发送，请在 Copilot 对话中查看反馈或继续追问。</p>}
      {!onAction && <p className="quiz-notice">请等待当前任务完成后再提交作答。</p>}
      {draft.revealed && hasSolution && <section className="quiz-solution"><h3>参考答案与解析</h3>{question.answer && <Markdown book={book}>{question.answer}</Markdown>}{question.explanation && <Markdown book={book}>{question.explanation}</Markdown>}</section>}
      {(draft.revealed || draft.sent) && <button className="text-button quiz-variation" disabled={!onAction} onClick={() => onAction?.(question, draft.answer, 'variation')}><RotateCcw size={15}/>针对这道题再练一道</button>}
    </article>
    <div className="quiz-footer"><button className="text-button" disabled={index === 0} onClick={() => navigate(index - 1)}><ArrowLeft size={16}/>上一题</button><span>根据教材编写</span><button className="text-button" disabled={index === artifact.questions.length - 1} onClick={() => navigate(index + 1)}>下一题<ArrowRight size={16}/></button></div>
    <p className="quiz-save-note">草稿暂存于当前卡片页面，提交后的作答与反馈保存在本机对话中。</p>
  </div>;
}
