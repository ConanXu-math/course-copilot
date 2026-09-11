import type { KnowledgeGraphNode } from './types';

export function matchesKnowledgeConcept(node: KnowledgeGraphNode, query: string): boolean {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
  const needle = normalize(query.trim());
  if (!needle) return true;
  const fields = [node.label, node.description, ...(Array.isArray(node.aliases) ? node.aliases : [])];
  return fields.some(value => typeof value === 'string' && normalize(value).includes(needle));
}

export function canOpenKnowledgeGraphPage(page: unknown, totalPages?: number): page is number {
  return typeof page === 'number' && Number.isInteger(page) && page > 0
    && (!totalPages || page <= totalPages);
}
