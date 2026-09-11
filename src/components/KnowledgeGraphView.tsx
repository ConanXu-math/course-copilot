import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronDown, Focus, Minus, Plus, Search, X } from 'lucide-react';
import type { Artifact, Book } from '../lib/types';
import { layoutKnowledgeNetwork } from '../lib/knowledge-network-layout';
import { layoutNetworkEdges } from '../lib/knowledge-network-edges';
import { canOpenKnowledgeGraphPage, matchesKnowledgeConcept } from '../lib/knowledge-graph-details';
import Markdown from './Markdown';
import './knowledge-network.css';

type GraphArtifact = Extract<Artifact, { kind: 'mindmap' | 'knowledge-graph' }>;
type Point = { x: number; y: number };
type View = Point & { scale: number };
type Drag = { pointer: number; node?: string; start: Point; origin: Point; moved: boolean };

export default function KnowledgeGraphView({ artifact, book, onPage }: {
  artifact: GraphArtifact; book?: Book; onPage: (page: number) => void;
}) {
  const network = useMemo(() => layoutKnowledgeNetwork(artifact.nodes, artifact.edges), [artifact.nodes, artifact.edges]);
  const groupById = useMemo(() => new Map(network.groups.map(group => [group.id, group])), [network]);
  const nodeById = useMemo(() => new Map(network.nodes.map(node => [node.id, node])), [network]);
  const stage = useRef<HTMLDivElement>(null);
  const inspector = useRef<HTMLElement>(null);
  const canvas = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [size, setSize] = useState({ width: 600, height: 480 });
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState(false);
  const relationElements = useRef(new Map<number, HTMLDetailsElement>());
  const relationsDisclosure = useRef<HTMLDetailsElement>(null);
  const geometricEdges = useMemo(() => layoutNetworkEdges(
    network.nodes.map(node => Object.hasOwn(positions, node.id) ? { ...node, ...positions[node.id] } : node),
    network.edges, selected,
  ), [network, positions, selected]);
  const markerId = `network-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const active = selected ?? hovered;
  const current = selected ? nodeById.get(selected) : undefined;
  const related = useMemo(() => {
    const ids = new Set<string>();
    if (active) {
      ids.add(active);
      network.edges.forEach(edge => {
        if (edge.source === active) ids.add(edge.target);
        if (edge.target === active) ids.add(edge.source);
      });
    }
    return ids;
  }, [active, network]);
  const relations = useMemo(() => selected ? network.edges.map((edge, index) => ({ edge, index })).filter(({ edge }) => edge.source === selected || edge.target === selected) : [], [network, selected]);
  const matches = useMemo(() => query.trim() ? network.nodes.filter(node => matchesKnowledgeConcept(node, query)) : [], [network, query]);
  const matchIds = new Set(matches.map(node => node.id));
  const position = (node: typeof network.nodes[number]) => Object.hasOwn(positions, node.id) ? positions[node.id] : node;
  const coverageStatus = { covered: '已覆盖', omitted: '未纳入本图', unread: '尚未读取' };
  const hasV2 = artifact.schemaVersion === 2;

  function pageButton(page: number, key?: string | number) {
    return canOpenKnowledgeGraphPage(page, book?.totalPages)
      ? <button key={key ?? page} className="network-page-link" onClick={() => onPage(page)}>PDF 第 {page} 页 <ArrowUpRight size={12}/></button>
      : <span key={key ?? page} className="network-page-unavailable">页码待核对</span>;
  }

  useEffect(() => {
    setSelected(previous => previous && nodeById.has(previous) ? previous : null);
    setHovered(previous => previous && nodeById.has(previous) ? previous : null);
  }, [nodeById]);

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [network.nodes.length > 0]);

  const fit = useCallback(() => {
    const points = network.nodes.map(node => ({ ...node, ...(Object.hasOwn(positions, node.id) ? positions[node.id] : {}) }));
    if (!points.length) return;
    const labels = geometricEdges.flatMap(group => group.label ? [group.label] : []);
    const left = Math.min(...points.map(node => node.x - Math.max(node.radius, Array.from(node.displayLabel).length * 7.5)), ...labels.map(label => label.x - label.width / 2));
    const right = Math.max(...points.map(node => node.x + Math.max(node.radius, Array.from(node.displayLabel).length * 7.5)), ...labels.map(label => label.x + label.width / 2));
    const top = Math.min(...points.map(node => node.y - node.radius - 15), ...labels.map(label => label.y - label.height / 2));
    const bottom = Math.max(...points.map(node => node.y + node.radius + 36), ...labels.map(label => label.y + label.height / 2));
    const availableHeight = Math.max(120, size.height - (inspector.current?.offsetHeight ?? 0) - (selected ? 24 : 0));
    const scale = Math.max(0.1, Math.min(1.7, (size.width - 48) / Math.max(1, right - left), (availableHeight - 64) / Math.max(1, bottom - top)));
    setView({ scale, x: size.width / 2 - (left + right) / 2 * scale, y: availableHeight / 2 - (top + bottom) / 2 * scale });
  }, [network, positions, size, geometricEdges, selected]);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => { fitRef.current(); }, [network, size]);

  function zoom(factor: number, anchor = { x: size.width / 2, y: size.height / 2 }) {
    setView(previous => {
      const scale = Math.max(0.1, Math.min(4, previous.scale * factor));
      const ratio = scale / previous.scale;
      return { scale, x: anchor.x - (anchor.x - previous.x) * ratio, y: anchor.y - (anchor.y - previous.y) * ratio };
    });
  }
  useEffect(() => {
    const svg = canvas.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = svg.getBoundingClientRect();
      const anchor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      setView(previous => {
        const scale = Math.max(0.1, Math.min(4, previous.scale * Math.exp(-event.deltaY * 0.0015)));
        const ratio = scale / previous.scale;
        return { scale, x: anchor.x - (anchor.x - previous.x) * ratio, y: anchor.y - (anchor.y - previous.y) * ratio };
      });
    };
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => svg.removeEventListener('wheel', wheel);
  }, [network.nodes.length > 0]);

  function focusNode(id: string) {
    const node = nodeById.get(id);
    if (!node) return;
    setSelected(id); setHovered(null); setQuery('');
    const point = position(node);
    const scale = Math.max(view.scale, 1);
    setView({ scale, x: size.width / 2 - point.x * scale, y: size.height * 0.3 - point.y * scale });
  }
  function openRelation(index: number) {
    const element = relationElements.current.get(index);
    if (!element) return;
    if (relationsDisclosure.current) relationsDisclosure.current.open = true;
    element.open = true;
    element.scrollIntoView({ block: 'nearest' });
  }
  function pointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    const id = (event.target as Element).closest('[data-network-node]')?.getAttribute('data-network-node') ?? undefined;
    const node = id ? nodeById.get(id) : undefined;
    drag.current = { pointer: event.pointerId, node: id, start: { x: event.clientX, y: event.clientY }, origin: node ? position(node) : { x: view.x, y: view.y }, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const movement = drag.current;
    if (!movement || movement.pointer !== event.pointerId) return;
    const dx = event.clientX - movement.start.x, dy = event.clientY - movement.start.y;
    if (!movement.moved && Math.hypot(dx, dy) < 4) return;
    movement.moved = true; setDragging(true); setHovered(null);
    if (movement.node) {
      const id = movement.node;
      setPositions(previous => ({ ...previous, [id]: { x: movement.origin.x + dx / view.scale, y: movement.origin.y + dy / view.scale } }));
    } else setView(previous => ({ ...previous, x: movement.origin.x + dx, y: movement.origin.y + dy }));
  }
  function pointerUp(event: React.PointerEvent<SVGSVGElement>) {
    const movement = drag.current;
    if (!movement || movement.pointer !== event.pointerId) return;
    if (!movement.moved) setSelected(previous => movement.node ? previous === movement.node ? null : movement.node : null);
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  if (!network.nodes.length) return <div className="artifact-empty">这份知识图谱还没有概念。</div>;
  return <div className="knowledge-network">
    <div className="network-toolbar">
      <div className="network-count"><strong>概念网络</strong><span>{network.nodes.length} 个概念 · {network.edges.length} 条联系</span></div>
      <div className="network-search"><Search size={14}/><input aria-label="搜索图谱概念" placeholder="搜索概念或别名…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && matches[0]) focusNode(matches[0].id); if (event.key === 'Escape') setQuery(''); }}/>{query && <button className="icon-button" aria-label="清空概念搜索" onClick={() => setQuery('')}><X size={13}/></button>}</div>
    </div>
    {hasV2 ? <div className="network-coverage-bar">
      <span className="network-mode">{artifact.detailLevel === 'detailed' ? '详细图谱' : artifact.detailLevel === 'overview' ? '概览图谱' : '知识图谱'}</span>
      {artifact.coverage ? <details className="network-coverage"><summary>覆盖说明 <ChevronDown size={13}/></summary><div className="network-coverage-panel">
        <p>{artifact.coverage.summary}</p>
        <ul>{artifact.coverage.items.map((item, index) => <li key={index}>
          <div className="network-coverage-heading"><strong>{item.title}</strong><span className={`coverage-status coverage-${item.status}`}>{coverageStatus[item.status]}</span></div>
          {item.note && <p>{item.note}</p>}
          <div className="network-coverage-pages">{item.pages.length ? item.pages.map((page, pageIndex) => pageButton(page, pageIndex)) : <span>尚无可靠页码范围</span>}</div>
        </li>)}</ul>
      </div></details> : <span className="network-legacy-note">这份资料尚未保存覆盖说明</span>}
    </div> : <p className="network-legacy-note network-legacy-bar">这份资料尚未保存逐条关系依据</p>}
    <div className="network-stage" ref={stage}>
      {query.trim() && <div className="network-search-results" aria-label="概念搜索结果">{matches.length ? matches.map(node => <button key={node.id} onClick={() => focusNode(node.id)}>{node.displayLabel}<small>{node.degree} 个直接联系</small></button>) : <p>没有找到这个概念</p>}</div>}
      <svg ref={canvas} className={`network-canvas${dragging ? ' dragging' : ''}`} role="group" aria-label="知识图谱概念网络，拖动平移，滚轮缩放" tabIndex={0}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { drag.current = null; setDragging(false); }}
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.25); }
          if (event.key === '-') { event.preventDefault(); zoom(0.8); }
          if (event.key === '0') { event.preventDefault(); fit(); }
          if (event.key === 'Escape') { setSelected(null); setQuery(''); }
          const direction = ({ ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] } as Record<string, number[]>)[event.key];
          if (direction) { event.preventDefault(); setView(previous => ({ ...previous, x: previous.x + direction[0], y: previous.y + direction[1] })); }
        }}>
        <defs>
          <marker id={markerId} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L6,3 L0,6 Z" fill="context-stroke"/></marker>
          {geometricEdges.map((group, index) => group.label && <mask key={group.key} id={`${markerId}-gap-${index}`} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" {...group.bounds} style={{ maskType: 'luminance' }}>
            <rect {...group.bounds} fill="white"/>
            <rect x={group.label.x - group.label.width / 2} y={group.label.y - group.label.height / 2} width={group.label.width} height={group.label.height} fill="black"/>
          </mask>)}
        </defs>
        <g className="network-world" transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          <g className="network-edges">{geometricEdges.map((group, index) => {
            const emphasized = active === group.source.id || active === group.target.id;
            return <path key={group.key} className={`network-edge${emphasized ? ' emphasized' : ''}`} d={group.path} mask={group.label ? `url(#${markerId}-gap-${index})` : undefined} stroke={groupById.get(group.source.group)?.color ?? '#8792a6'} strokeWidth={emphasized ? 1.8 : 0.9} opacity={active ? emphasized ? 0.5 : 0.05 : 0.2} markerEnd={emphasized ? `url(#${markerId})` : undefined}><title>{group.edges.map(({ edge }) => `${group.source.displayLabel} → ${edge.label || '未标注关系'} → ${group.target.displayLabel}`).join('\n')}</title></path>;
          })}</g>
          <g className="network-nodes">{network.nodes.map(node => {
            const point = position(node), color = groupById.get(node.group)?.color ?? '#8e8ba6';
            const dim = selected ? !related.has(node.id) : query.trim() ? !matchIds.has(node.id) : false;
            const chosen = selected === node.id;
            const fontSize = 11 + Math.min(4, Math.sqrt(node.degree));
            return <g key={node.id} data-network-node={node.id} className={`network-node${chosen ? ' selected' : ''}`} transform={`translate(${point.x} ${point.y})`} opacity={dim ? 0.18 : 1}
              role="button" tabIndex={0} aria-label={`查看概念：${node.displayLabel}`} aria-pressed={chosen}
              onPointerEnter={() => { if (!drag.current) setHovered(node.id); }} onPointerLeave={() => setHovered(null)}
              onFocus={() => setHovered(node.id)} onBlur={() => setHovered(null)}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); focusNode(node.id); } if (event.key === 'Escape') { setSelected(null); setHovered(null); } }}>
              <title>{node.displayLabel} · {node.degree} 个直接联系{node.page ? ` · PDF 第 ${node.page} 页` : ''}</title>
              <circle className="network-node-halo" r={node.radius + 9} fill={color} opacity={chosen ? 0.14 : 0.05}/>
              <circle className="network-node-dot" r={node.radius} fill={color} fillOpacity={0.38} stroke={color} strokeOpacity={chosen ? 0.8 : 0.55} strokeWidth={chosen ? 2.7 : 1.2}/>
              {chosen && <circle r={node.radius + 5} fill="none" stroke={color} strokeWidth={1.4}/>}
              <text className="network-node-label" y={node.radius + 17} textAnchor="middle" fontSize={fontSize} fontWeight={node.degree >= 4 ? 650 : 450}>{node.displayLabel}</text>
            </g>;
          })}</g>
          <g className="network-edge-labels">{geometricEdges.map(group => group.label && <g key={group.key} transform={`translate(${group.label.x} ${group.label.y})`} style={{ color: groupById.get(group.source.group)?.color ?? '#8792a6' }}>
            {group.label.rows.map(row => {
              const edge = network.edges[row.index];
              const title = `${group.source.displayLabel} → ${edge.label || '未标注关系'} → ${group.target.displayLabel}`;
              return <g key={row.index} className="network-edge-label" role="button" tabIndex={0} aria-label={`查看关系依据：${title}`}
                onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
                onClick={event => { event.stopPropagation(); openRelation(row.index); }}
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); openRelation(row.index); } if (event.key === 'Escape') { setSelected(null); setHovered(null); } }}>
                <title>{title} · 点击展开依据</title>
                <rect className="network-edge-label-hit" x={-group.label!.width / 2} y={row.y - 12} width={group.label!.width} height={row.lines.length * 15 + 4} rx={3}/>
                <text textAnchor="middle">{row.lines.map((line, index) => <tspan key={index} x={0} y={row.y + index * 15}>{line}</tspan>)}</text>
              </g>;
            })}
          </g>)}</g>
        </g>
      </svg>
      <div className="network-controls" aria-label="知识网络视图控制"><button aria-label="放大知识网络" onClick={() => zoom(1.25)}><Plus size={17}/></button><button aria-label="缩小知识网络" onClick={() => zoom(0.8)}><Minus size={17}/></button><button aria-label="适应整个知识网络" onClick={fit}><Focus size={17}/></button></div>
      <span className="network-zoom">{Math.round(view.scale * 100)}%</span>
      {current && <aside ref={inspector} className="network-inspector" aria-label="概念及关系详情">
        <div className="network-inspector-heading"><span style={{ background: groupById.get(current.group)?.color }}/><strong>概念与联系</strong><button className="icon-button" aria-label="关闭概念详情" onClick={() => { setSelected(null); setHovered(null); }}><X size={15}/></button></div>
        <div className="network-inspector-body" key={current.id}>
        <div className="network-concept"><Markdown book={book}>{current.label}</Markdown></div>
        <div className="network-concept-meta">{current.type && <span className="network-concept-type">{current.type}</span>}<span>{current.degree} 个直接联系 · {relations.length} 条关系</span>{canOpenKnowledgeGraphPage(current.page, book?.totalPages) && pageButton(current.page)}</div>
        {current.aliases?.length ? <p className="network-aliases"><strong>别名</strong>{current.aliases.join(' · ')}</p> : null}
        {current.description && <div className="network-description"><Markdown book={book}>{current.description}</Markdown></div>}
        <details className="network-relations" ref={relationsDisclosure}><summary className="network-relations-heading">关系与依据 <span>点击连线文字查看 <ChevronDown size={12}/></span></summary>{relations.length ? relations.map(({ edge, index }) => {
          const outgoing = edge.source === current.id;
          const other = nodeById.get(outgoing ? edge.target : edge.source);
          const source = nodeById.get(edge.source), target = nodeById.get(edge.target);
          return other && <details key={index} ref={element => { if (element) relationElements.current.set(index, element); else relationElements.current.delete(index); }} className="network-relation">
            <summary>{outgoing ? <ArrowUpRight size={14}/> : <ArrowDownLeft size={14}/>}<span>
              <strong>{source?.displayLabel} → {edge.label || '未标注关系'} → {target?.displayLabel}</strong>
              <span className="network-relation-badges">{edge.basis === 'inference' ? <small className="relation-inference">推断</small> : edge.basis === 'textbook' && Boolean(edge.evidence?.length) ? <small>教材依据</small> : null}{edge.conditions && <small>有适用条件</small>}</span>
            </span><ChevronDown size={13} className="network-relation-chevron"/></summary>
            <div className="network-relation-detail">
              {edge.conditions && <div className="network-relation-conditions"><strong>适用条件</strong><Markdown book={book}>{edge.conditions}</Markdown></div>}
              {edge.basis === 'inference' && <p className="network-inference-note">这是一条推断关系；以下教材内容支持其前提，结论由此前提推导。</p>}
              {edge.evidence?.length ? <ol className="network-evidence">{edge.evidence.map((evidence, evidenceIndex) => <li key={evidenceIndex}>
                <div className="network-evidence-location">{pageButton(evidence.page)}{evidence.location && <span>{evidence.location}</span>}</div>
                <Markdown book={book}>{evidence.summary}</Markdown>
              </li>)}</ol> : <p className="network-legacy-note">这条关系尚未保存教材依据。</p>}
              <button className="network-neighbor-link" onClick={() => focusNode(other.id)}>查看概念：{other.displayLabel}<ArrowUpRight size={13}/></button>
            </div>
          </details>;
        }) : <p>这份资料尚未记录该概念的关系。</p>}</details>
        </div>
      </aside>}
    </div>
    <div className="network-legend" aria-label="按连接划分的概念群组">{network.groups.map(group => <span key={group.id}><i style={{ background: group.color }}/>{group.label}</span>)}</div>
    <div className="network-footer"><span>颜色按连接分组 · 节点越大，直接联系越多</span><span>拖动浏览 · 滚轮缩放 · 点击查看</span></div>
  </div>;
}
