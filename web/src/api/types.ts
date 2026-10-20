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
  page?: string;
  generated?: string;
  ref?: string;
}

export interface Page { id: string; name: string; background?: string }

export interface DocData {
  counter: number;
  artboards: Artboard[];
  pages?: Page[];
  // components, tokens, references, ... are added to the type when the phase that uses them needs them.
  [key: string]: unknown;
}

export interface Comment {
  id: string;
  targetId: string;
  artboardId: string;
  text: string;
  resolved?: boolean;
  createdAt: number;
  replies: { text: string; createdAt: number; author?: string }[];
  [key: string]: unknown;
}
