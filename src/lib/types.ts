export type SkillId = 'chat' | 'explain' | 'mindmap' | 'knowledge-graph' | 'slides' | 'video';
export type Scope = 'page' | 'chapter' | 'selection' | 'book';

export interface Chapter {
  id: string;
  title: string;
  page: number;
  level: number;
}

export interface Book {
  id: string;
  title: string;
  filename: string;
  url: string;
  totalPages?: number;
  chapters: Chapter[];
  initialPage?: number;
  local?: boolean;
  source?: 'included' | 'imported';
  directory?: string;
}

export interface PersonalSettings {
  activeCourseId?: string;
  columnWidths?: { sidebar?: number; copilot?: number };
}

export interface StorageInfo { directory: string; settings: PersonalSettings }

export interface ReadingState {
  page: number;
  bookmarks: number[];
  notes: { id: string; page: number; content: string }[];
  conversationId: string;
  messages: Message[];
  artifacts: Artifact[];
}

export interface ConversationInfo { id: string; title: string; updatedAt: string; messageCount: number }

export interface SkillInfo {
  id: SkillId;
  title: string;
  description: string;
  available: boolean;
}

export interface SkillRequest {
  skillId: SkillId;
  book: { id: string; title: string; filename: string; totalPages?: number; local?: boolean };
  chapter?: Chapter;
  page: number;
  scope: Scope;
  selectedText: string;
  pageText: string;
  prompt: string;
  artifact?: Artifact;
  history: { role: 'user' | 'assistant'; content: string }[];
}

export type Artifact =
  | { id: string; title: string; kind: 'markdown'; content: string }
  | { id: string; title: string; kind: 'mindmap' | 'knowledge-graph'; nodes: { id: string; label: string; page?: number }[]; edges: { source: string; target: string; label?: string }[] }
  | { id: string; title: string; kind: 'slides'; slides: { title: string; content: string }[]; url?: string }
  | { id: string; title: string; kind: 'video' | 'file'; url: string; filename?: string };

export type SkillEvent =
  | { type: 'progress'; message: string }
  | { type: 'text'; content: string }
  | { type: 'artifact'; artifact: Artifact }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  skillId?: SkillId;
  status?: 'running' | 'done' | 'error' | 'stopped';
  progress?: string;
  artifacts?: Artifact[];
}
