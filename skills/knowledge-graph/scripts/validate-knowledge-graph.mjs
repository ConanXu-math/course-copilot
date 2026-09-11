import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string' && value.trim().length > 0;
const isPage = (value, totalPages) => Number.isSafeInteger(value) && value >= 1 && value <= totalPages;

function validateCoverage(result, totalPages) {
  if (!['overview', 'detailed'].includes(result.detailLevel)) {
    throw new Error('v2 detailLevel 必须是 overview 或 detailed。');
  }
  const { coverage } = result;
  if (!isObject(coverage) || !isText(coverage.summary)) {
    throw new Error('v2 coverage.summary 必须是非空文本。');
  }
  if (!Array.isArray(coverage.items) || coverage.items.length === 0) {
    throw new Error('v2 coverage.items 必须是非空数组。');
  }
  for (const [index, item] of coverage.items.entries()) {
    const field = `coverage.items[${index}]`;
    if (!isObject(item) || !isText(item.title)) {
      throw new Error(`${field}.title 必须是非空文本。`);
    }
    if (!['covered', 'omitted', 'unread'].includes(item.status)) {
      throw new Error(`${field}.status 必须是 covered、omitted 或 unread。`);
    }
    if (typeof item.note !== 'string') throw new Error(`${field}.note 必须是文本。`);
    if (!Array.isArray(item.pages) || item.pages.some(page => !isPage(page, totalPages))) {
      throw new Error(`${field}.pages 必须是由 1–${totalPages} 内整数构成的数组。`);
    }
    if (item.pages.length === 0 && item.status !== 'unread') {
      throw new Error(`${field}.pages 仅在 status 为 unread 时可以为空。`);
    }
  }
}

function validateV2Node(node, conceptKeys) {
  if (!isText(node.conceptKey)) throw new Error(`节点 ${node.id} 的 conceptKey 必须是非空文本。`);
  if (conceptKeys.has(node.conceptKey)) throw new Error(`conceptKey 重复：${node.conceptKey}`);
  conceptKeys.add(node.conceptKey);
  if (!isText(node.type)) throw new Error(`节点 ${node.id} 的 type 必须是非空文本。`);
  if (node.aliases !== undefined && (!Array.isArray(node.aliases) || node.aliases.some(alias => !isText(alias)))) {
    throw new Error(`节点 ${node.id} 的 aliases 必须是由非空文本构成的数组。`);
  }
  if (node.description !== undefined && typeof node.description !== 'string') {
    throw new Error(`节点 ${node.id} 的 description 必须是文本。`);
  }
}

function validateV2Edge(edge, edgeIds, totalPages) {
  if (!isText(edge.id)) throw new Error('v2 每条连线的 id 必须是非空文本。');
  if (edgeIds.has(edge.id)) throw new Error(`连线 ID 重复：${edge.id}`);
  edgeIds.add(edge.id);
  if (!['textbook', 'inference'].includes(edge.basis)) {
    throw new Error(`连线 ${edge.id} 的 basis 必须是 textbook 或 inference。`);
  }
  if (edge.conditions !== undefined && typeof edge.conditions !== 'string') {
    throw new Error(`连线 ${edge.id} 的 conditions 必须是文本。`);
  }
  if (!Array.isArray(edge.evidence) || edge.evidence.length === 0) {
    throw new Error(`连线 ${edge.id} 的 evidence 必须是非空数组。`);
  }
  for (const [index, entry] of edge.evidence.entries()) {
    const field = `连线 ${edge.id} 的 evidence[${index}]`;
    if (!isObject(entry) || !isPage(entry.page, totalPages)) {
      throw new Error(`${field}.page 必须是 1–${totalPages} 内的整数。`);
    }
    if (!isText(entry.summary)) throw new Error(`${field}.summary 必须是非空文本。`);
    if (entry.location !== undefined && typeof entry.location !== 'string') {
      throw new Error(`${field}.location 必须是文本。`);
    }
  }
}

/** Validate a directed concept graph; multiple parents, cycles and subgraphs are valid. */
export function validateKnowledgeGraph(result, expectedId, totalPages, options = {}) {
  if (!isText(expectedId)) throw new Error('预期结果 ID 不能为空。');
  if (!Number.isSafeInteger(totalPages) || totalPages < 1) {
    throw new Error('教材总页数必须是正整数。');
  }
  if (!isObject(result)) throw new Error('结果必须是 JSON 对象。');
  if (result.kind !== 'knowledge-graph') throw new Error('kind 必须是 knowledge-graph。');
  if (result.schemaVersion !== undefined && result.schemaVersion !== 2) {
    throw new Error('不支持的 schemaVersion：仅支持未标注版本的旧图谱或 schemaVersion: 2。');
  }
  const isV2 = result.schemaVersion === 2;
  if (options.requireV2 && !isV2) throw new Error('新生成的知识图谱必须使用 schemaVersion: 2。');
  if (result.id !== expectedId) throw new Error('结果 id 与指定的结果 ID 不一致。');
  if (!isText(result.title)) throw new Error('title 必须是非空文本。');
  if (!Array.isArray(result.nodes) || result.nodes.length === 0) {
    throw new Error('nodes 必须是非空数组。');
  }
  if (!Array.isArray(result.edges)) throw new Error('edges 必须是数组。');
  if (isV2) validateCoverage(result, totalPages);

  const neighbors = new Map();
  const conceptKeys = new Set();
  for (const node of result.nodes) {
    if (!isObject(node) || !isText(node.id) || !isText(node.label)) {
      throw new Error('每个节点必须有非空的 id 和 label。');
    }
    if (neighbors.has(node.id)) throw new Error(`节点 ID 重复：${node.id}`);
    if (node.page !== undefined && !isPage(node.page, totalPages)) {
      throw new Error(`节点 ${node.id} 的 page 必须是 1–${totalPages} 内的整数。`);
    }
    if (isV2) validateV2Node(node, conceptKeys);
    neighbors.set(node.id, []);
  }

  const edgeKeys = new Set();
  const edgeIds = new Set();
  for (const edge of result.edges) {
    if (!isObject(edge) || !neighbors.has(edge.source) || !neighbors.has(edge.target)) {
      throw new Error('连线的 source 和 target 必须引用已有节点 ID。');
    }
    if (edge.source === edge.target) throw new Error(`节点 ${edge.source} 不能连向自身。`);
    if (!isText(edge.label)) throw new Error('每条连线的 label 必须是非空的关系文字。');
    if (isV2) validateV2Edge(edge, edgeIds, totalPages);
    const key = JSON.stringify(isV2 ? [edge.source, edge.target, edge.label.trim()] : [edge.source, edge.target]);
    if (edgeKeys.has(key)) {
      if (isV2) throw new Error(`关系重复：${edge.source} → ${edge.target}（${edge.label.trim()}）。`);
      throw new Error(`同向连线重复：${edge.source} → ${edge.target}。请将这些关系合并到一条连线的 label，避免重叠。`);
    }
    edgeKeys.add(key);
    neighbors.get(edge.source).push(edge.target);
    neighbors.get(edge.target).push(edge.source);
  }

  // Report weakly connected components without imposing any root or acyclicity rule.
  const visited = new Set();
  let componentCount = 0;
  for (const id of neighbors.keys()) {
    if (visited.has(id)) continue;
    componentCount++;
    const queue = [id];
    visited.add(id);
    for (let index = 0; index < queue.length; index++) {
      for (const neighbor of neighbors.get(queue[index])) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return { nodeCount: result.nodes.length, edgeCount: result.edges.length, componentCount };
}

async function main() {
  const [resultPath, expectedId, totalPages, ...extra] = process.argv.slice(2);
  const requireV2 = extra.length === 1 && extra[0] === '--require-v2';
  if (!resultPath || !expectedId || !totalPages || (extra.length && !requireV2)) {
    throw new Error('用法：node validate-knowledge-graph.mjs <结果 JSON> <预期结果 ID> <教材总页数> [--require-v2]');
  }
  if (!/^[1-9]\d*$/.test(totalPages)) throw new Error('教材总页数必须是正整数。');
  const result = JSON.parse(await readFile(resultPath, 'utf8'));
  const summary = validateKnowledgeGraph(result, expectedId, Number(totalPages), { requireV2 });
  console.log(`校验通过：${summary.nodeCount} 个节点，${summary.edgeCount} 条连线，${summary.componentCount} 个连通分量（忽略方向）。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`知识图谱校验失败：${error.message}`);
    process.exitCode = 1;
  });
}
