// Shortcut labels: ⌘ and ⇧ on Mac, Ctrl and Shift elsewhere. Keys are handled with `metaKey || ctrlKey`, so only the text differs.
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const modLabel = () => (isMac ? '⌘' : 'Ctrl+');
export const shiftLabel = () => (isMac ? '⇧' : 'Shift+');
