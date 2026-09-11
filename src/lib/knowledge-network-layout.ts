import type { KnowledgeGraphEdge, KnowledgeGraphNode } from './types';

export type NetworkNode = KnowledgeGraphNode;
export type NetworkEdge = KnowledgeGraphEdge;
export type NetworkLayoutNode = NetworkNode & {
  displayLabel: string; x: number; y: number; radius: number; degree: number; group: string;
};
export type NetworkGroup = { id: string; label: string; color: string };
export type NetworkLayout = {
  nodes: NetworkLayoutNode[];
  edges: NetworkEdge[];
  groups: NetworkGroup[];
  bounds: { x: number; y: number; width: number; height: number };
};

const COLORS = ['#7c83db', '#df9661', '#76ac87', '#cf7f9a', '#64a7bc', '#b499cf', '#b6aa5b', '#a68a79'];
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Plain, compact labels for the overview; the node's complete label is untouched. */
export function shortenNetworkLabel(label: string, maxLength = 12): string {
  const commands: Record<string, string> = {
    ell: 'ℓ', alpha: 'α', beta: 'β', gamma: 'γ', lambda: 'λ', pi: 'π', xi: 'ξ', theta: 'θ',
    sigma: 'σ', omega: 'ω', mu: 'μ', delta: 'δ', nabla: '∇', in: '∈', approx: '≈',
    ge: '≥', geq: '≥', le: '≤', leq: '≤', times: '×', cdot: '·', infinity: '∞', infty: '∞',
  };
  const plain = label
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/\$\$?([^$]*?)\$\$?/g, (_, formula: string) => formula
      .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2')
      .replace(/\\([a-zA-Z]+)/g, (_, command: string) => commands[command] ?? '')
      .replace(/\\\|/g, '∥').replace(/[{}_^\\]/g, ''))
    .replace(/（[^）]*）|\([^)]*\)/g, '')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[$\\{}#*_`~>]/g, '')
    .replace(/\s+/g, ' ').trim();
  const concise = plain.split(/[：:；;\n]/, 1)[0].trim() || plain || '知识点';
  const limit = Math.max(1, Math.floor(Number.isFinite(maxLength) ? maxLength : 12));
  const characters = Array.from(concise);
  return characters.length <= limit ? concise : characters.slice(0, Math.max(0, limit - 1)).join('') + '…';
}

type Community = { members: number[]; degree: number; links: Map<number, number> };

// Greedy modularity uses distinct, undirected connections only. These are
// connection communities, not textbook chapters or inferred subject classes.
function connectionGroups(neighbors: Set<number>[]): number[][] {
  const communities = new Map<number, Community>(neighbors.map((links, index) => [index, {
    members: [index], degree: links.size, links: new Map([...links].map(target => [target, 1])),
  }]));
  const edgeCount = neighbors.reduce((sum, links) => sum + links.size, 0) / 2;
  if (!edgeCount) return [...communities.values()].map(group => group.members);
  for (let round = 0; round < neighbors.length - 1; round++) {
    let bestA = -1, bestB = -1, bestGain = 1e-12;
    for (const [a, group] of communities) {
      for (const [b, connections] of group.links) {
        if (a >= b) continue;
        const other = communities.get(b)!;
        const gain = connections / edgeCount - group.degree * other.degree / (2 * edgeCount * edgeCount);
        if (gain > bestGain + 1e-12 || (Math.abs(gain - bestGain) <= 1e-12 && bestA >= 0 && (a < bestA || (a === bestA && b < bestB)))) {
          bestA = a; bestB = b; bestGain = gain;
        }
      }
    }
    if (bestA < 0) break;
    const kept = communities.get(bestA)!, removed = communities.get(bestB)!;
    kept.members.push(...removed.members); kept.degree += removed.degree;
    kept.links.delete(bestB);
    for (const [other, weight] of removed.links) {
      if (other === bestA) continue;
      const combined = (kept.links.get(other) ?? 0) + weight;
      kept.links.set(other, combined);
      const peer = communities.get(other)!;
      peer.links.delete(bestB); peer.links.set(bestA, combined);
    }
    communities.delete(bestB);
  }
  return [...communities.values()].map(group => group.members.sort((a, b) => a - b));
}

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) { result ^= character.codePointAt(0)!; result = Math.imul(result, 16777619); }
  return (result >>> 0) / 4294967296;
}

/** A bounded, deterministic force simulation. No tree, ranks or grid are imposed. */
export function layoutKnowledgeNetwork(inputNodes: NetworkNode[], inputEdges: NetworkEdge[]): NetworkLayout {
  const unique = new Map<string, NetworkNode>();
  for (const node of inputNodes) if (!unique.has(node.id)) unique.set(node.id, node);
  const sourceNodes = [...unique.values()].sort((a, b) => compare(a.id, b.id));
  const count = sourceNodes.length;
  const edges = inputEdges.filter(edge => unique.has(edge.source) && unique.has(edge.target)).map(edge => ({ ...edge }));
  if (!count) return { nodes: [], edges, groups: [], bounds: { x: -80, y: -80, width: 160, height: 160 } };
  const indexById = new Map(sourceNodes.map((node, index) => [node.id, index]));
  const neighbors = sourceNodes.map(() => new Set<number>());
  for (const edge of edges) {
    const a = indexById.get(edge.source)!, b = indexById.get(edge.target)!;
    if (a !== b) { neighbors[a].add(b); neighbors[b].add(a); }
  }
  const communities = connectionGroups(neighbors).sort((a, b) => b.length - a.length || a[0] - b[0]);
  const membership = new Array<number>(count);
  const groups = communities.map((members, index) => {
    members.forEach(member => { membership[member] = index; });
    const memberSet = new Set(members);
    const central = [...members].sort((a, b) => {
      const internalA = [...neighbors[a]].filter(peer => memberSet.has(peer)).length;
      const internalB = [...neighbors[b]].filter(peer => memberSet.has(peer)).length;
      return internalB - internalA || neighbors[b].size - neighbors[a].size || a - b;
    })[0];
    return { id: `connection-${sourceNodes[members[0]].id}`, label: shortenNetworkLabel(sourceNodes[central].label), color: COLORS[index % COLORS.length] };
  });
  const nodes: NetworkLayoutNode[] = sourceNodes.map((node, index) => ({
    ...node, displayLabel: shortenNetworkLabel(node.label), x: 0, y: 0,
    radius: Math.min(24, 8 + Math.sqrt(neighbors[index].size) * 3), degree: neighbors[index].size,
    group: groups[membership[index]].id,
  }));
  const halfWidths = nodes.map(node => Math.max(node.radius, Array.from(node.displayLabel).reduce((width, character) => width + (/[^\x00-\xff]/.test(character) ? 15 : 8), 0) / 2) + 7);
  const halfHeights = nodes.map(node => node.radius + 14);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  communities.forEach((members, groupIndex) => {
    const angle = groupIndex * goldenAngle;
    const distance = communities.length > 1 ? 135 * Math.sqrt(groupIndex) : 0;
    members.forEach((member, localIndex) => {
      const localAngle = localIndex * goldenAngle + hash(nodes[member].id) * 0.6;
      const spread = 48 * Math.sqrt(localIndex + 0.5);
      nodes[member].x = Math.cos(angle) * distance + Math.cos(localAngle) * spread;
      nodes[member].y = Math.sin(angle) * distance + Math.sin(localAngle) * spread;
    });
  });
  const links: [number, number][] = [];
  neighbors.forEach((peers, a) => [...peers].sort((x, y) => x - y).forEach(b => { if (a < b) links.push([a, b]); }));
  const vx = new Float64Array(count), vy = new Float64Array(count);
  const fx = new Float64Array(count), fy = new Float64Array(count);
  const iterations = count > 100 ? 320 : 420;
  for (let iteration = 0; iteration < iterations; iteration++) {
    fx.fill(0); fy.fill(0);
    const cooling = 1 - iteration / iterations;
    const maxStep = 1.5 + 9 * cooling;
    const centers = communities.map(members => ({
      x: members.reduce((sum, member) => sum + nodes[member].x, 0) / members.length,
      y: members.reduce((sum, member) => sum + nodes[member].y, 0) / members.length,
    }));
    for (let a = 0; a < count; a++) {
      fx[a] -= nodes[a].x * 0.012; fy[a] -= nodes[a].y * 0.012;
      // A gentle pull to the moving community center makes connected clusters
      // readable without imposing fixed sectors or changing any relationships.
      fx[a] += (centers[membership[a]].x - nodes[a].x) * 0.035;
      fy[a] += (centers[membership[a]].y - nodes[a].y) * 0.035;
      for (let b = a + 1; b < count; b++) {
        let dx = nodes[b].x - nodes[a].x, dy = nodes[b].y - nodes[a].y;
        if (Math.abs(dx) + Math.abs(dy) < 0.001) { dx = 0.1; dy = 0.1; }
        const distance = Math.max(1, Math.hypot(dx, dy));
        const repulsion = 6500 / (distance * distance);
        const pushX = dx / distance * repulsion, pushY = dy / distance * repulsion;
        fx[a] -= pushX; fy[a] -= pushY; fx[b] += pushX; fy[b] += pushY;
        const overlapX = halfWidths[a] + halfWidths[b] - Math.abs(dx);
        const overlapY = halfHeights[a] + halfHeights[b] - Math.abs(dy);
        if (overlapX > 0 && overlapY > 0) {
          // Include the compact text below each circle in its collision box.
          const horizontal = overlapX < overlapY;
          const push = Math.min(12, (horizontal ? overlapX : overlapY) * 0.35);
          if (horizontal) { const amount = Math.sign(dx) * push; fx[a] -= amount; fx[b] += amount; }
          else { const amount = Math.sign(dy) * push; fy[a] -= amount; fy[b] += amount; }
        }
      }
    }
    for (const [a, b] of links) {
      const dx = nodes[b].x - nodes[a].x, dy = nodes[b].y - nodes[a].y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const desired = 85 + nodes[a].radius + nodes[b].radius + (membership[a] === membership[b] ? 0 : 45);
      const pull = (distance - desired) * 0.045;
      const x = dx / distance * pull, y = dy / distance * pull;
      fx[a] += x; fy[a] += y; fx[b] -= x; fy[b] -= y;
    }
    for (let index = 0; index < count; index++) {
      vx[index] = (vx[index] + fx[index]) * 0.65;
      vy[index] = (vy[index] + fy[index]) * 0.65;
      const speed = Math.max(1, Math.hypot(vx[index], vy[index]) / maxStep);
      nodes[index].x += vx[index] / speed; nodes[index].y += vy[index] / speed;
    }
  }
  // Resolve remaining text/circle overlaps without pinning nodes to rows.
  for (let pass = 0; pass < 180; pass++) {
    let overlap = false;
    for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) {
      const dx = nodes[b].x - nodes[a].x, dy = nodes[b].y - nodes[a].y;
      const overlapX = halfWidths[a] + halfWidths[b] - Math.abs(dx);
      const overlapY = halfHeights[a] + halfHeights[b] - Math.abs(dy);
      if (overlapX <= 0.01 || overlapY <= 0.01) continue;
      overlap = true;
      if (overlapX < overlapY) {
        const move = (overlapX + 0.1) / 2 * (dx < 0 ? -1 : 1);
        nodes[a].x -= move; nodes[b].x += move;
      } else {
        const move = (overlapY + 0.1) / 2 * (dy < 0 ? -1 : 1);
        nodes[a].y -= move; nodes[b].y += move;
      }
    }
    if (!overlap) break;
  }
  // Dense stars can still leave a few overlaps after relaxation. Move only
  // those nodes to the nearest sampled free spot, with a finite outer fallback.
  const placed: number[] = [];
  const placementOrder = nodes.map((_, index) => index).sort((a, b) => nodes[b].degree - nodes[a].degree || a - b);
  for (const index of placementOrder) {
    const node = nodes[index], originalX = node.x, originalY = node.y;
    const collides = () => placed.some(other => Math.abs(node.x - nodes[other].x) < halfWidths[index] + halfWidths[other]
      && Math.abs(node.y - nodes[other].y) < halfHeights[index] + halfHeights[other]);
    for (let attempt = 1; collides(); attempt++) {
      if (attempt > 1200) {
        node.x = Math.max(...placed.map(other => nodes[other].x + halfWidths[other])) + halfWidths[index] + 1;
        break;
      }
      const angle = attempt * goldenAngle + hash(node.id) * Math.PI * 2;
      const distance = 12 * Math.sqrt(attempt);
      node.x = originalX + Math.cos(angle) * distance;
      node.y = originalY + Math.sin(angle) * distance;
    }
    placed.push(index);
  }
  const meanX = nodes.reduce((sum, node) => sum + node.x, 0) / count;
  const meanY = nodes.reduce((sum, node) => sum + node.y, 0) / count;
  nodes.forEach(node => { node.x -= meanX; node.y -= meanY; });
  const left = Math.min(...nodes.map((node, index) => node.x - halfWidths[index])) - 45;
  const top = Math.min(...nodes.map(node => node.y - node.radius)) - 45;
  const right = Math.max(...nodes.map((node, index) => node.x + halfWidths[index])) + 45;
  const bottom = Math.max(...nodes.map(node => node.y + node.radius + 28)) + 45;
  const positioned = new Map(nodes.map(node => [node.id, node]));
  return { nodes: [...unique.keys()].map(id => positioned.get(id)!), edges, groups, bounds: { x: left, y: top, width: right - left, height: bottom - top } };
}
