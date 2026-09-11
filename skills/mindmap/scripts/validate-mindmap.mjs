import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string' && value.trim().length > 0;

/** Validate the Artifact contract and a single rooted, parent-to-child tree. */
export function validateMindmap(result, expectedId, totalPages) {
  if (!isText(expectedId)) throw new Error('预期结果 ID 不能为空。');
  if (!Number.isSafeInteger(totalPages) || totalPages < 1) {
    throw new Error('教材总页数必须是正整数。');
  }
  if (!isObject(result)) throw new Error('结果必须是 JSON 对象。');
  if (result.kind !== 'mindmap') throw new Error('kind 必须是 mindmap。');
  if (result.id !== expectedId) throw new Error('结果 id 与指定的结果 ID 不一致。');
  if (!isText(result.title)) throw new Error('title 必须是非空文本。');
  if (!Array.isArray(result.nodes) || result.nodes.length === 0) {
    throw new Error('nodes 必须是非空数组。');
  }
  if (!Array.isArray(result.edges)) throw new Error('edges 必须是数组。');

  const children = new Map();
  const parents = new Map();
  for (const node of result.nodes) {
    if (!isObject(node) || !isText(node.id) || !isText(node.label)) {
      throw new Error('每个节点必须有非空的 id 和 label。');
    }
    if (children.has(node.id)) throw new Error(`节点 ID 重复：${node.id}`);
    if (node.page !== undefined && (!Number.isSafeInteger(node.page) || node.page < 1 || node.page > totalPages)) {
      throw new Error(`节点 ${node.id} 的 page 必须是 1–${totalPages} 内的整数。`);
    }
    children.set(node.id, []);
    parents.set(node.id, 0);
  }

  const edgeKeys = new Set();
  for (const edge of result.edges) {
    if (!isObject(edge) || !children.has(edge.source) || !children.has(edge.target)) {
      throw new Error('连线的 source 和 target 必须引用已有节点 ID。');
    }
    if (edge.source === edge.target) throw new Error(`节点 ${edge.source} 不能连向自身。`);
    if (edge.label !== undefined && typeof edge.label !== 'string') {
      throw new Error('连线 label 必须是文本。');
    }
    const key = JSON.stringify([edge.source, edge.target]);
    if (edgeKeys.has(key)) throw new Error(`连线重复：${edge.source} → ${edge.target}`);
    edgeKeys.add(key);
    children.get(edge.source).push(edge.target);
    const parentCount = parents.get(edge.target) + 1;
    if (parentCount > 1) throw new Error(`节点 ${edge.target} 只能有一个父节点。`);
    parents.set(edge.target, parentCount);
  }

  const roots = [...parents.keys()].filter(id => parents.get(id) === 0);
  const queue = [...roots];
  for (let index = 0; index < queue.length; index += 1) {
    for (const child of children.get(queue[index])) {
      parents.set(child, parents.get(child) - 1);
      if (parents.get(child) === 0) queue.push(child);
    }
  }
  if (queue.length !== result.nodes.length) throw new Error('思维导图中存在有向环。');
  if (roots.length !== 1) throw new Error('思维导图必须全连通且只有一个根节点。');
  return { rootId: roots[0], nodeCount: result.nodes.length, edgeCount: result.edges.length };
}

async function main() {
  const [resultPath, expectedId, totalPages, ...extra] = process.argv.slice(2);
  if (!resultPath || !expectedId || !totalPages || extra.length) {
    throw new Error('用法：node validate-mindmap.mjs <结果 JSON> <预期结果 ID> <教材总页数>');
  }
  if (!/^[1-9]\d*$/.test(totalPages)) throw new Error('教材总页数必须是正整数。');
  const result = JSON.parse(await readFile(resultPath, 'utf8'));
  const summary = validateMindmap(result, expectedId, Number(totalPages));
  console.log(`校验通过：${summary.nodeCount} 个节点，${summary.edgeCount} 条连线，根节点 ${summary.rootId}。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`思维导图校验失败：${error.message}`);
    process.exitCode = 1;
  });
}
