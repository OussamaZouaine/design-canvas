// The one registry of user actions. The command palette, the main menu and the shortcuts dialog all read this list,
// so a label or a key can never differ between them. Pure and import-free (erasable TS only) so `node --test` can
// load it; everything that touches the app arrives through `ActionCtx`, built in `shell/useActions.ts`.
//
// `keys` here are DISPLAY data. The real key handlers stay where they always were (canvas/edit.ts, Shell.tsx
// FloatingToolbar); when one changes, change its `keys` here and nothing else.

export type ActionGroup = 'Tools' | 'Edit' | 'Structure' | 'View' | 'Panels' | 'Export' | 'Project' | 'Help' | 'Pages' | 'Boards';

export interface Action {
  id: string;
  label: string;
  group: ActionGroup;
  // Shortcuts as neutral specs ('mod+shift+e', 'v', '?'); the first is the one menus show, all are listed in the dialog.
  keys?: string[];
  // Extra search words ("rectangle" finds "Shape tool").
  keywords?: string[];
  run: () => void;
  // Absent = always available. Disabled actions stay listed (greyed) so the palette doubles as documentation.
  enabled?: () => boolean;
}

// Tools: id, label and key live here so the toolbar and the palette share them (icons stay in Shell.tsx).
export const TOOL_DEFS = [
  { id: 'move', label: 'Move', key: 'V' },
  { id: 'hand', label: 'Hand', key: 'H' },
  { id: 'frame', label: 'Frame', key: 'F' },
  { id: 'rect', label: 'Rectangle', key: 'R' },
  { id: 'ellipse', label: 'Ellipse', key: 'O' },
  { id: 'line', label: 'Line', key: 'L' },
  { id: 'pen', label: 'Pen', key: 'P' },
  { id: 'text', label: 'Text', key: 'T' },
  { id: 'image', label: 'Image', key: 'I' },
  { id: 'comment', label: 'Comment', key: 'C' },
] as const;

// What the registry needs from the app. Booleans are getters so the palette reads fresh state each time it opens.
export interface ActionCtx {
  pages: { id: string; name: string }[];
  boards: { id: string; name: string }[];
  has: { selection: () => boolean; layers: () => boolean; oneLayer: () => boolean; paste: () => boolean };
  do: {
    tool: (id: string) => void;
    undo: () => void; redo: () => void;
    selectAll: () => void;
    duplicate: () => void; copy: () => void; cut: () => void; paste: (inPlace: boolean) => void; remove: () => void;
    group: () => void; ungroup: () => void; autoLayout: () => void;
    zoomIn: () => void; zoomOut: () => void; fit: () => void;
    toggleFollow: () => void; toggleRulers: () => void; toggleTheme: () => void;
    toggleLayers: () => void; togglePanel: () => void;
    tab: (id: 'design' | 'comment' | 'agents') => void;
    view: (id: 'history' | 'styles') => void;
    openExport: () => void; copyPng: () => void;
    projects: () => void; connect: () => void; shortcuts: () => void;
    page: (id: string) => void; board: (id: string) => void;
  };
}

export function buildActions(c: ActionCtx): Action[] {
  const sel = c.has.selection, layers = c.has.layers;
  const list: Action[] = [
    ...TOOL_DEFS.map((t): Action => ({ id: `tool.${t.id}`, label: t.label, group: 'Tools', keys: [t.key.toLowerCase()], keywords: ['tool', t.id], run: () => c.do.tool(t.id) })),

    { id: 'edit.undo', label: 'Undo', group: 'Edit', keys: ['mod+z'], run: c.do.undo },
    { id: 'edit.redo', label: 'Redo', group: 'Edit', keys: ['mod+shift+z'], run: c.do.redo },
    { id: 'edit.selectAll', label: 'Select all', group: 'Edit', keys: ['mod+a'], run: c.do.selectAll },
    { id: 'edit.cut', label: 'Cut', group: 'Edit', keys: ['mod+x'], run: c.do.cut, enabled: sel },
    { id: 'edit.copy', label: 'Copy', group: 'Edit', keys: ['mod+c'], run: c.do.copy, enabled: sel },
    { id: 'edit.paste', label: 'Paste', group: 'Edit', keys: ['mod+v'], run: () => c.do.paste(false), enabled: c.has.paste },
    { id: 'edit.pasteInPlace', label: 'Paste in place', group: 'Edit', keys: ['mod+shift+v'], run: () => c.do.paste(true), enabled: c.has.paste },
    { id: 'edit.duplicate', label: 'Duplicate', group: 'Edit', keys: ['mod+d'], run: c.do.duplicate, enabled: sel },
    { id: 'edit.delete', label: 'Delete', group: 'Edit', keys: ['delete', 'backspace'], keywords: ['remove'], run: c.do.remove, enabled: sel },

    { id: 'structure.group', label: 'Group', group: 'Structure', keys: ['mod+g'], run: c.do.group, enabled: layers },
    { id: 'structure.ungroup', label: 'Ungroup', group: 'Structure', keys: ['mod+shift+g', 'mod+alt+g'], run: c.do.ungroup, enabled: c.has.oneLayer },
    { id: 'structure.autoLayout', label: 'Add auto layout', group: 'Structure', keys: ['shift+a'], keywords: ['flex', 'wrap'], run: c.do.autoLayout, enabled: layers },

    { id: 'view.zoomIn', label: 'Zoom in', group: 'View', run: c.do.zoomIn },
    { id: 'view.zoomOut', label: 'Zoom out', group: 'View', run: c.do.zoomOut },
    { id: 'view.fit', label: 'Fit all artboards', group: 'View', keywords: ['zoom'], run: c.do.fit },
    { id: 'view.follow', label: 'Follow Claude\'s camera', group: 'View', keywords: ['agent'], run: c.do.toggleFollow },
    { id: 'view.rulers', label: 'Toggle rulers', group: 'View', keys: ['shift+r'], run: c.do.toggleRulers },
    { id: 'view.theme', label: 'Toggle light or dark theme', group: 'View', keywords: ['dark', 'light', 'appearance'], run: c.do.toggleTheme },

    { id: 'panel.layers', label: 'Toggle pages and layers', group: 'Panels', run: c.do.toggleLayers },
    { id: 'panel.inspector', label: 'Toggle inspector', group: 'Panels', run: c.do.togglePanel },
    { id: 'panel.design', label: 'Show design', group: 'Panels', keywords: ['inspector'], run: () => c.do.tab('design') },
    { id: 'panel.comments', label: 'Show comments', group: 'Panels', run: () => c.do.tab('comment') },
    { id: 'panel.agents', label: 'Show agents', group: 'Panels', keywords: ['mcp'], run: () => c.do.tab('agents') },
    { id: 'panel.history', label: 'Show history', group: 'Panels', keywords: ['activity', 'versions', 'snapshots'], run: () => c.do.view('history') },
    { id: 'panel.styles', label: 'Show styles', group: 'Panels', keywords: ['theme', 'tokens', 'memory'], run: () => c.do.view('styles') },

    { id: 'export.open', label: 'Export…', group: 'Export', keys: ['mod+shift+e'], keywords: ['png', 'svg', 'pdf', 'download'], run: c.do.openExport },
    { id: 'export.copyPng', label: 'Copy as PNG', group: 'Export', run: c.do.copyPng, enabled: sel },

    { id: 'project.home', label: 'Go to projects', group: 'Project', keywords: ['home'], run: c.do.projects },
    { id: 'project.connect', label: 'Connect agents', group: 'Project', keywords: ['mcp', 'claude', 'codex', 'cursor'], run: c.do.connect },

    { id: 'help.shortcuts', label: 'Keyboard shortcuts', group: 'Help', keys: ['?'], run: c.do.shortcuts },
  ];
  for (const p of c.pages) list.push({ id: `page.${p.id}`, label: p.name, group: 'Pages', keywords: ['page'], run: () => c.do.page(p.id) });
  for (const b of c.boards) list.push({ id: `board.${b.id}`, label: b.name, group: 'Boards', keywords: ['artboard', 'frame'], run: () => c.do.board(b.id) });
  return list;
}

// 'mod+shift+e' -> 'Ctrl+Shift+E' (or '⌘⇧E' on Mac). Single characters upper-case; named keys capitalised.
export function formatKeys(spec: string, mac: boolean): string {
  const parts = spec.split('+');
  const key = parts.pop() ?? '';
  const mods = parts.map((m) => (mac
    ? ({ mod: '⌘', shift: '⇧', alt: '⌥' } as Record<string, string>)[m]
    : ({ mod: 'Ctrl', shift: 'Shift', alt: 'Alt' } as Record<string, string>)[m]) ?? m);
  const k = key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
  return mac ? mods.join('') + k : [...mods, k].join('+');
}

// Mouse and modifier gestures have no action to run, but the dialog still lists them next to the real shortcuts.
export const GESTURES: { title: string; rows: [string, string][] }[] = [
  { title: 'Select', rows: [
    ['Click', 'Select a layer at the current level'], ['Double-click', 'Go into a layer (or edit text)'], ['Ctrl+click', 'Select the deepest layer'],
    ['Shift+click', 'Add or remove from the selection'], ['Drag on empty space', 'Marquee select'],
    ['Enter / Shift+Enter', 'Go into / select the parent'], ['Tab / Shift+Tab', 'Next / previous sibling'], ['Esc', 'Up one level, then deselect'],
  ] },
  { title: 'Move and resize', rows: [
    ['Drag a layer in a flow', 'Reorder or move into another container'], ['Alt+drag', 'Copy while dragging'], ['Arrows', 'Nudge 1 px (reorder in a flow)'],
    ['Shift+arrows', 'Nudge 10 px'], ['Ctrl while dragging', 'Turn snapping off'], ['Shift while dragging', 'Lock the axis / keep the ratio'],
    ['Alt while resizing', 'Resize from the centre'], ['Alt+hover', 'Measure distances to the hovered layer'], ['Space+drag', 'Pan'],
  ] },
];

// Shortcut rows for the dialog: action groups that have keys, in a fixed order. `all` keeps every alias of an action.
const DIALOG_GROUPS: ActionGroup[] = ['Edit', 'Structure', 'Tools', 'View', 'Export', 'Help'];
export function shortcutRows(actions: Action[], mac: boolean): { title: string; rows: [string, string][] }[] {
  return DIALOG_GROUPS.map((g) => ({
    title: g === 'Tools' ? 'Tools' : g,
    rows: actions.filter((a) => a.group === g && a.keys?.length).map((a): [string, string] => [a.keys!.map((k) => formatKeys(k, mac)).join(' or '), a.label]),
  })).filter((g) => g.rows.length);
}
