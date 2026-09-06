import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';

type Column = 'sidebar' | 'copilot';
type Widths = Record<Column, number>;
const minimum = { sidebar: 170, copilot: 320 };
const maximum = { sidebar: 380, copilot: 680 };

function defaults(width: number): Widths {
  return { sidebar: width >= 1600 ? 245 : width > 1190 ? 224 : 192, copilot: width >= 1600 ? 410 : width > 1190 ? 380 : width > 960 ? 338 : 330 };
}

export function useColumnWidths(outlineOpen: boolean, saved: Partial<Widths> | null, onSave: (widths: Partial<Widths>) => void) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(window.innerWidth);
  const [preferred, setPreferred] = useState<Partial<Widths>>({});
  const initialized = useRef(false);
  const changed = useRef(false);
  const saveCallback = useRef(onSave);
  saveCallback.current = onSave;
  useEffect(() => {
    if (saved !== null && !initialized.current) {
      initialized.current = true;
      setPreferred(saved);
    }
  }, [saved]);
  const [dragging, setDragging] = useState<Column | null>(null);
  const fallback = defaults(width);
  const hasSidebar = outlineOpen && width > 960;
  const readerMinimum = width > 960 ? 340 : 280;
  const sidebar = Math.min(preferred.sidebar ?? fallback.sidebar, Math.max(minimum.sidebar, width - minimum.copilot - readerMinimum));
  const sidebarSpace = hasSidebar ? sidebar : 0;
  const copilot = Math.max(minimum.copilot, Math.min(preferred.copilot ?? fallback.copilot, width - sidebarSpace - readerMinimum));
  const widths = { sidebar, copilot };
  const limits = {
    sidebar: Math.max(minimum.sidebar, Math.min(maximum.sidebar, width - copilot - readerMinimum)),
    copilot: Math.max(minimum.copilot, Math.min(maximum.copilot, width - sidebarSpace - readerMinimum)),
  };

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const measure = () => setWidth(workspace.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (dragging || !initialized.current || !changed.current) return;
    changed.current = false; saveCallback.current(preferred);
  }, [preferred, dragging]);

  function resize(column: Column, value: number) {
    changed.current = true;
    setPreferred(current => ({ ...current, [column]: Math.max(minimum[column], Math.min(limits[column], value)) }));
  }

  function reset(column: Column) {
    changed.current = true;
    setPreferred(current => {
      const next = { ...current };
      delete next[column];
      return next;
    });
  }

  return {
    workspaceRef, dragging,
    style: { '--sidebar-width': `${sidebar}px`, '--copilot-width': `${copilot}px` } as CSSProperties,
    resizers: <ColumnResizers workspaceRef={workspaceRef} widths={widths} limits={limits} hasSidebar={hasSidebar} desktop={width > 700} onResize={resize} onReset={reset} onDragging={setDragging}/>,
  };
}

function ColumnResizers({ workspaceRef, widths, limits, hasSidebar, desktop, onResize, onReset, onDragging }: {
  workspaceRef: RefObject<HTMLDivElement | null>; widths: Widths; limits: Widths; hasSidebar: boolean; desktop: boolean;
  onResize: (column: Column, width: number) => void; onReset: (column: Column) => void; onDragging: (column: Column | null) => void;
}) {
  const drag = useRef<{ column: Column; pointerId: number; startX: number; startWidth: number; target: HTMLDivElement } | null>(null);

  function finish() {
    const current = drag.current;
    drag.current = null;
    if (current?.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
    onDragging(null);
  }

  useEffect(() => {
    window.addEventListener('blur', finish);
    return () => window.removeEventListener('blur', finish);
  });
  useEffect(() => { if (!desktop || (!hasSidebar && drag.current?.column === 'sidebar')) finish(); }, [desktop, hasSidebar]);

  function begin(event: PointerEvent<HTMLDivElement>, column: Column) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { column, pointerId: event.pointerId, startX: event.clientX, startWidth: widths[column], target: event.currentTarget };
    onDragging(column);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId || !workspaceRef.current) return;
    const delta = (event.clientX - current.startX) * (current.column === 'sidebar' ? 1 : -1);
    onResize(current.column, current.startWidth + delta);
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>, column: Column) {
    const step = event.shiftKey ? 40 : 12;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const direction = (event.key === 'ArrowRight' ? 1 : -1) * (column === 'sidebar' ? 1 : -1);
      onResize(column, widths[column] + direction * step);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      onResize(column, event.key === 'Home' ? minimum[column] : limits[column]);
    } else if (event.key === 'Enter') {
      event.preventDefault(); onReset(column);
    } else if (event.key === 'Escape') finish();
  }

  if (!desktop) return null;
  return <>{(['sidebar', 'copilot'] as const).filter(column => column !== 'sidebar' || hasSidebar).map(column => <div
    key={column} role="separator" aria-orientation="vertical" tabIndex={0}
    aria-label={column === 'sidebar' ? '调整目录宽度' : '调整教材与 Copilot 宽度'}
    aria-valuemin={minimum[column]} aria-valuemax={Math.round(limits[column])} aria-valuenow={Math.round(widths[column])}
    aria-valuetext={`${Math.round(widths[column])} 像素`} aria-controls={column === 'sidebar' ? 'course-outline' : 'course-reading'}
    title="左右拖动调整宽度 · 双击恢复默认 · 方向键微调"
    className={`column-resizer column-resizer-${column}`}
    onPointerDown={event => begin(event, column)} onPointerMove={move}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onDoubleClick={() => onReset(column)} onKeyDown={event => keyboard(event, column)}
  ><span/></div>)}</>;
}
