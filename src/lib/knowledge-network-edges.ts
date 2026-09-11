import type { NetworkEdge, NetworkLayoutNode } from './knowledge-network-layout';

type Point = { x: number; y: number };
type Rectangle = Point & { width: number; height: number };
export type NetworkEdgeLabel = Rectangle & {
  rows: { index: number; lines: string[]; y: number }[];
};
export type NetworkEdgeGroup = {
  key: string;
  source: NetworkLayoutNode;
  target: NetworkLayoutNode;
  edges: { edge: NetworkEdge; index: number }[];
  path: string;
  /** Top-left coordinates and size, including room for the arrow marker. */
  bounds: Rectangle;
  label?: NetworkEdgeLabel;
};

const FONT_SIZE = 11;
const LINE_HEIGHT = 15;
const PADDING = 6;
const ROW_GAP = 4;
const MAX_LINE_WIDTH = 140;

function textWidth(text: string, fontSize = FONT_SIZE): number {
  return Array.from(text).reduce((width, character) => width + fontSize * (/\s/.test(character) ? 0.35 : /[^\x00-\xff]/.test(character) ? 1 : 0.6), 0);
}

function wrapText(text: string): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const character of Array.from(paragraph)) {
      if (line && textWidth(line + character) > MAX_LINE_WIDTH) {
        lines.push(line);
        line = '';
      }
      line += character;
    }
    lines.push(line);
  }
  return lines;
}

function makeLabel(edges: NetworkEdgeGroup['edges']): NetworkEdgeLabel {
  const rows = edges.map(({ edge, index }) => ({
    index,
    lines: wrapText(`${edge.basis === 'inference' ? '推断 · ' : ''}${edge.label?.trim() ? edge.label : '未标注关系'}`),
    y: 0,
  }));
  const width = Math.max(20, ...rows.flatMap(row => row.lines.map(line => textWidth(line)))) + PADDING * 2;
  const height = rows.reduce((sum, row) => sum + row.lines.length * LINE_HEIGHT, 0) + Math.max(0, rows.length - 1) * ROW_GAP + PADDING * 2;
  let y = -height / 2 + PADDING + FONT_SIZE;
  for (const row of rows) {
    row.y = y;
    y += row.lines.length * LINE_HEIGHT + ROW_GAP;
  }
  return { x: 0, y: 0, width, height, rows };
}

function nodeObstacles(node: NetworkLayoutNode): Rectangle[] {
  const fontSize = 11 + Math.min(4, Math.sqrt(node.degree));
  return [
    { x: node.x, y: node.y, width: (node.radius + 7) * 2, height: (node.radius + 7) * 2 },
    { x: node.x, y: node.y + node.radius + 17 - fontSize * 0.35, width: textWidth(node.displayLabel, fontSize) + 8, height: fontSize + 8 },
  ];
}

function overlapArea(a: Rectangle, b: Rectangle): number {
  const x = Math.min(a.x + a.width / 2 + 3, b.x + b.width / 2) - Math.max(a.x - a.width / 2 - 3, b.x - b.width / 2);
  const y = Math.min(a.y + a.height / 2 + 3, b.y + b.height / 2) - Math.max(a.y - a.height / 2 - 3, b.y - b.height / 2);
  return x > 0 && y > 0 ? x * y : 0;
}

function curveBounds(points: Point[]): Rectangle {
  const left = Math.min(...points.map(point => point.x)) - 16;
  const top = Math.min(...points.map(point => point.y)) - 16;
  const right = Math.max(...points.map(point => point.x)) + 16;
  const bottom = Math.max(...points.map(point => point.y)) + 16;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function curve(source: NetworkLayoutNode, target: NetworkLayoutNode, bend: number): { path: string; center: Point; bounds: Rectangle } {
  const dx = target.x - source.x, dy = target.y - source.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) {
    // Legacy self links and temporarily coincident dragged nodes still need a
    // visible directed curve rather than a degenerate quadratic path.
    const side = bend < 0 ? -1 : 1, reach = Math.max(45, Math.abs(bend));
    const start = { x: source.x + side * (source.radius + 2), y: source.y };
    const end = { x: target.x, y: target.y - target.radius - 3 };
    const first = { x: source.x + side * reach, y: source.y - reach * 0.2 };
    const second = { x: target.x + side * reach * 0.2, y: target.y - reach };
    return {
      path: `M ${start.x} ${start.y} C ${first.x} ${first.y} ${second.x} ${second.y} ${end.x} ${end.y}`,
      center: { x: (start.x + end.x) / 8 + (first.x + second.x) * 3 / 8, y: (start.y + end.y) / 8 + (first.y + second.y) * 3 / 8 },
      bounds: curveBounds([start, first, second, end]),
    };
  }
  const control = { x: (source.x + target.x) / 2 - dy / length * bend, y: (source.y + target.y) / 2 + dx / length * bend };
  const sourceDistance = Math.hypot(control.x - source.x, control.y - source.y);
  const targetDistance = Math.hypot(control.x - target.x, control.y - target.y);
  const start = { x: source.x + (control.x - source.x) / sourceDistance * (source.radius + 2), y: source.y + (control.y - source.y) / sourceDistance * (source.radius + 2) };
  const end = { x: target.x + (control.x - target.x) / targetDistance * (target.radius + 3), y: target.y + (control.y - target.y) / targetDistance * (target.radius + 3) };
  return {
    path: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
    center: { x: start.x / 4 + control.x / 2 + end.x / 4, y: start.y / 4 + control.y / 2 + end.y / 4 },
    bounds: curveBounds([start, control, end]),
  };
}

/** Directed geometry and complete relation labels for the currently selected
 * concept. Coordinates are in graph space, so dragging and zoom share one
 * transform with nodes; parallel predicates never disappear through deduping. */
export function layoutNetworkEdges(nodes: NetworkLayoutNode[], edges: NetworkEdge[], selected: string | null): NetworkEdgeGroup[] {
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const groups = new Map<string, NetworkEdgeGroup>();
  edges.forEach((edge, index) => {
    const source = nodeById.get(edge.source), target = nodeById.get(edge.target);
    if (!source || !target) return;
    const key = JSON.stringify([edge.source, edge.target]);
    const group = groups.get(key);
    if (group) group.edges.push({ edge, index });
    else groups.set(key, { key, source, target, edges: [{ edge, index }], path: '', bounds: { x: 0, y: 0, width: 0, height: 0 } });
  });
  // Faded, unrelated concepts may sit behind a label; routing around the whole
  // overview would send short selected links far outside the visible cluster.
  const related = new Set<string>(selected ? [selected] : []);
  for (const edge of edges) {
    if (edge.source === selected) related.add(edge.target);
    if (edge.target === selected) related.add(edge.source);
  }
  const obstacles = nodes.filter(node => related.has(node.id)).flatMap(nodeObstacles);
  const placed: Rectangle[] = [];
  for (const group of groups.values()) {
    const { source, target } = group;
    const length = Math.hypot(target.x - source.x, target.y - source.y);
    const defaultBend = Math.min(28, length * 0.08);
    const initial = curve(source, target, defaultBend);
    group.path = initial.path;
    group.bounds = initial.bounds;
    if (selected !== source.id && selected !== target.id) continue;
    const label = makeLabel(group.edges);
    const bends = [defaultBend, -defaultBend];
    // Prefer a small displacement. Progressively wider bends provide room on
    // short links and between labels around highly connected concepts.
    for (const distance of [45, 80, 130, 200, 300, 440]) bends.push(distance, -distance);
    let best = initial, bestScore = Infinity;
    for (const bend of bends) {
      const candidate = curve(source, target, bend);
      const box = { ...label, ...candidate.center };
      const score = [...obstacles, ...placed].reduce((sum, obstacle) => sum + overlapArea(box, obstacle), 0);
      if (score < bestScore) {
        best = candidate; bestScore = score;
      }
      if (score === 0) break;
    }
    group.path = best.path;
    group.bounds = best.bounds;
    group.label = { ...label, ...best.center };
    placed.push(group.label);
  }
  return [...groups.values()];
}
