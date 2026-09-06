import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, ExternalLink, LoaderCircle, Maximize, Minus, Plus, RotateCw } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import type { Book, Chapter } from '../lib/types';
import './textbook-reader.css';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface TextbookReaderProps {
  book: Book;
  page: number;
  onPageChange: (page: number) => void;
  onDocumentReady: (data: { totalPages: number; chapters: Chapter[] }) => void;
  onTextChange: (text: string) => void;
  onSelectionChange: (text: string) => void;
}

async function readOutline(pdf: PDFDocumentProxy): Promise<Chapter[]> {
  const outline = await pdf.getOutline();
  if (!outline) return [];
  type OutlineItem = (typeof outline)[number];
  async function visit(items: OutlineItem[], level: number, prefix: string): Promise<Chapter[]> {
    const groups = await Promise.all(items.map(async (item, index) => {
      const id = `${prefix}-${index + 1}`;
      let pageNumber: number | undefined;
      try {
        const destination = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
        if (Array.isArray(destination) && destination[0] != null) {
          pageNumber = typeof destination[0] === 'number'
            ? destination[0] + 1
            : (await pdf.getPageIndex(destination[0])) + 1;
        }
      } catch {
        // A malformed outline destination must not prevent reading the PDF.
      }
      const current = pageNumber && pageNumber >= 1 && pageNumber <= pdf.numPages
        ? [{ id, title: item.title, page: pageNumber, level }]
        : [];
      return [...current, ...await visit(item.items ?? [], level + 1, id)];
    }));
    return groups.flat();
  }
  return visit(outline, 0, 'outline');
}

function pdfErrorMessage(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  if (name === 'PasswordException') return '这份 PDF 需要密码，请先使用 PDF 阅读器解锁后重新导入。';
  if (name === 'InvalidPDFException') return '无法读取这份 PDF，请确认文件完整且格式正确。';
  if (name === 'MissingPDFException' || name === 'UnexpectedResponseException') return '暂时无法获取教材文件，请检查本地服务是否已经启动。';
  return '教材暂时无法显示，请重试，或在新窗口打开原 PDF。';
}

export default function TextbookReader({ book, page, onPageChange, onDocumentReady, onTextChange, onSelectionChange }: TextbookReaderProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onDocumentReady, onTextChange, onSelectionChange });
  callbacks.current = { onDocumentReady, onTextChange, onSelectionChange };
  const [documentState, setDocumentState] = useState<{ url: string; pdf: PDFDocumentProxy } | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  const [displayScale, setDisplayScale] = useState(1);
  const [pageInput, setPageInput] = useState(String(page));
  const [busy, setBusy] = useState(true);
  const [loadPercent, setLoadPercent] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [textNote, setTextNote] = useState('');
  const [retry, setRetry] = useState(0);
  const pdf = documentState?.url === book.url ? documentState.pdf : null;
  const totalPages = pdf?.numPages ?? book.totalPages;
  const currentPage = Math.max(1, Math.min(page, totalPages ?? page));

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => setViewportWidth(viewport.clientWidth);
    measure();
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(measure, 120);
    });
    observer.observe(viewport);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setDocumentState(null);
    setError('');
    setBusy(true);
    setLoadPercent(null);
    setZoom(null);
    const loadingTask = getDocument({
      url: book.url,
      cMapUrl: '/api/pdf-assets/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/api/pdf-assets/standard_fonts/',
      wasmUrl: '/api/pdf-assets/wasm/',
    });
    loadingTask.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
      if (!cancelled && total > 0) setLoadPercent(Math.min(100, Math.round(loaded / total * 100)));
    };
    void loadingTask.promise.then(async (loadedPdf) => {
      if (cancelled) return;
      setDocumentState({ url: book.url, pdf: loadedPdf });
      const chapters = book.chapters.length ? book.chapters : await readOutline(loadedPdf).catch(() => []);
      if (!cancelled) callbacks.current.onDocumentReady({ totalPages: loadedPdf.numPages, chapters });
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setError(pdfErrorMessage(reason));
      setBusy(false);
    });
    return () => {
      cancelled = true;
      void loadingTask.destroy().catch(() => {});
    };
  }, [book.id, book.url, retry]);

  useEffect(() => {
    setPageInput(String(currentPage));
    callbacks.current.onTextChange('');
    callbacks.current.onSelectionChange('');
    viewportRef.current?.scrollTo({ top: 0, left: 0 });
  }, [book.id, book.url, currentPage]);

  useEffect(() => {
    const paper = paperRef.current;
    if (!pdf || !paper || viewportWidth <= 0) return;
    let cancelled = false;
    let renderingTask: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    setBusy(true);
    setError('');
    setTextNote('');
    // Each render owns its canvas so a fast page turn never reuses an active one.
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', `${book.title}，第 ${currentPage} 页`);
    canvas.setAttribute('role', 'img');
    const textContainer = document.createElement('div');
    textContainer.className = 'textLayer';
    paper.replaceChildren(canvas, textContainer);
    void (async () => {
      try {
        const pdfPage = await pdf.getPage(currentPage);
        if (cancelled) return;
        const natural = pdfPage.getViewport({ scale: 1 });
        const fitScale = Math.max(180, viewportWidth - 48) / natural.width;
        const scale = zoom ?? fitScale;
        const viewport = pdfPage.getViewport({ scale });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        setDisplayScale(scale);
        paper.style.width = `${viewport.width}px`;
        paper.style.height = `${viewport.height}px`;
        paper.style.setProperty('--total-scale-factor', String(scale * pdfPage.userUnit));
        paper.style.setProperty('--scale-factor', String(scale));
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        renderingTask = pdfPage.render({
          canvas,
          viewport,
          transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        const textPromise = pdfPage.getTextContent().then(
          (content) => ({ content, error: null }),
          (textError: unknown) => ({ content: null, error: textError }),
        );
        await renderingTask.promise;
        if (cancelled) return;
        setBusy(false);
        try {
          const result = await textPromise;
          if (cancelled) return;
          if (!result.content) throw result.error;
          const content = result.content;
          const text = content.items.map((item) => 'str' in item ? item.str + (item.hasEOL ? '\n' : '') : '').join('');
          callbacks.current.onTextChange(text.trim());
          if (!text.trim()) setTextNote('这一页没有可选文字；扫描教材需要接入文字识别功能。');
          textLayer = new TextLayer({ textContentSource: content, container: textContainer, viewport });
          await textLayer.render();
        } catch {
          if (!cancelled) setTextNote('这一页的文字暂时无法提取，仍可阅读原文。');
        }
      } catch (reason) {
        if (cancelled) return;
        setError(pdfErrorMessage(reason));
        setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
      renderingTask?.cancel();
      textLayer?.cancel();
      paper.replaceChildren();
    };
  }, [pdf, currentPage, viewportWidth, zoom, book.title]);

  function submitPage() {
    const number = Number(pageInput);
    if (Number.isInteger(number) && number >= 1 && (!totalPages || number <= totalPages)) {
      onPageChange(number);
    } else {
      setPageInput(String(currentPage));
    }
  }

  function captureSelection() {
    const selection = window.getSelection();
    const paper = paperRef.current;
    if (!selection || !paper) return;
    if (paper.contains(selection.anchorNode) && paper.contains(selection.focusNode)) {
      callbacks.current.onSelectionChange(selection.toString().trim());
    }
  }

  return (
    <section className="textbook-reader" aria-label="教材阅读器">
      <div className="reader-toolbar" aria-label="教材阅读工具">
        <div className="reader-page-controls">
          <button type="button" className="reader-icon-button" aria-label="上一页" title="上一页" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage <= 1 || !pdf}>
            <ChevronLeft size={17} />
          </button>
          <label className="reader-page-field">
            <span className="reader-page-label">页码</span>
            <input aria-label="跳转到页码" inputMode="numeric" value={pageInput} onChange={(event) => setPageInput(event.target.value)} onBlur={submitPage} onKeyDown={(event) => { if (event.key === 'Enter') { submitPage(); event.currentTarget.blur(); } }} disabled={!pdf} />
            <span className="reader-page-total">/ {totalPages ?? '—'}</span>
          </label>
          <button type="button" className="reader-icon-button" aria-label="下一页" title="下一页" onClick={() => onPageChange(currentPage + 1)} disabled={!pdf || currentPage >= (totalPages ?? 1)}>
            <ChevronRight size={17} />
          </button>
        </div>
        <div className="reader-zoom-controls">
          <button type="button" className="reader-icon-button" aria-label="缩小教材" title="缩小" disabled={!pdf || displayScale <= 0.35} onClick={() => setZoom(Math.max(0.35, displayScale - 0.15))}><Minus size={16} /></button>
          <span className="reader-zoom-value">{Math.round(displayScale * 100)}%</span>
          <button type="button" className="reader-icon-button" aria-label="放大教材" title="放大" disabled={!pdf || displayScale >= 3} onClick={() => setZoom(Math.min(3, displayScale + 0.15))}><Plus size={16} /></button>
          <span className="reader-toolbar-divider" />
          <button type="button" className={`reader-fit-button${zoom === null ? ' is-active' : ''}`} title="适合宽度" aria-label="适合宽度" disabled={!pdf} onClick={() => setZoom(null)}><Maximize size={15} /><span>适合宽度</span></button>
          <a className="reader-icon-button reader-open-link" href={`${book.url}#page=${currentPage}`} target="_blank" rel="noreferrer" title="在新窗口打开原 PDF" aria-label="在新窗口打开原 PDF"><ExternalLink size={15} /></a>
        </div>
      </div>
      <div className="reader-viewport" ref={viewportRef}>
        <div className="reader-page-stage">
          <div className="reader-paper" ref={paperRef} onPointerUp={captureSelection} onKeyUp={captureSelection} style={{ visibility: busy || error ? 'hidden' : 'visible' }} />
          {busy && !error && <div className="reader-status" role="status"><LoaderCircle className="reader-spinner" size={25} /><strong>{pdf ? '正在打开这一页' : '正在载入教材'}</strong><span>{!pdf && loadPercent !== null ? `已载入 ${loadPercent}%` : '保留教材原有的公式与排版'}</span></div>}
          {error && <div className="reader-status reader-error" role="alert"><AlertCircle size={27} /><strong>教材没有打开</strong><span>{error}</span><button type="button" onClick={() => setRetry((value) => value + 1)}><RotateCw size={15} />重新加载</button></div>}
        </div>
      </div>
      <div className="reader-footer"><span>{textNote || '选中教材文字，即可交给 Copilot 继续讲解'}</span><span className="reader-footer-page">PDF 第 {currentPage} 页</span></div>
    </section>
  );
}
