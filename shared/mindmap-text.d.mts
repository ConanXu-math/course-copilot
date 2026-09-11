export interface MindmapTextNode {
  label: string;
  originalLabel?: string;
  userText?: string;
}

export function getMindmapText(node: MindmapTextNode): { original: string; addition: string };
export function normalizeMindmapNode<T extends MindmapTextNode>(node: T): T & { label: string; userText: string };
