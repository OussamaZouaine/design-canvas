// Shapes of what the Node server sends. Kept loose where the server is loose; later phases tighten them.

export interface ProjectSummary {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  artboardCount: number;
  active?: boolean;
  // First artboard, used for the live card preview on Home (null/absent for an empty project).
  cover?: { width: number; height: number; html: string } | null;
}

export interface ProjectMeta {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  normalize?: boolean;
}

export interface Artboard {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  // The server sends `null` for boards whose HTML did not change; the SSE layer refills it before the store sees it.
  html: string;
  heightMode?: 'fit'; // absent = fixed; fit = `height` is a minimum and the board grows with its content
  page?: string;
  generated?: string;
  ref?: string;
}

export interface Page { id: string; name: string; background?: string }

// Design tokens: CSS custom property values, plus named modes that override some of them.
export interface ThemeData { tokens: Record<string, string>; modes?: Record<string, Record<string, string>> }

export interface DocData {
  counter: number;
  artboards: Artboard[];
  pages?: Page[];
  theme?: ThemeData;
  // components, tokens, references, ... are added to the type when the phase that uses them needs them.
  [key: string]: unknown;
}

export interface Comment {
  id: string;
  targetId: string;
  artboardId: string;
  text: string;
  author?: 'user' | 'claude';
  resolved?: boolean;
  createdAt: number;
  replies: { text: string; createdAt: number; author?: string }[];
  [key: string]: unknown;
}

// One row of GET /api/comments: a comment plus where it lives, resolved by the server.
export interface OverviewComment {
  id: string;
  projectId: string;
  projectName: string;
  artboardName?: string;
  targetId: string;
  text: string;
  author?: 'user' | 'claude';
  resolved?: boolean;
  orphaned?: boolean;
  element?: { tag: string; text?: string };
  createdAt: number;
  replies: { text: string; createdAt: number; author?: string }[];
}
