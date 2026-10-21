// The artboard contract: how every board's HTML is wrapped, wherever it is drawn (live shadow DOM, hidden
// measuring host, snapshot SVG, exported HTML). One definition so the places cannot drift apart: a drift
// would mean a screenshot that differs from what the user sees, or a measurement that lies.
// src/contract.mjs repeats these strings for the server; test/contract.test.mjs fails if they differ.

// Reset + [hidden] rule. `[hidden]` needs !important because inline `display:flex` would otherwise beat it.
// Direct children never shrink: in a column flex box an `overflow:hidden` child would otherwise be squashed to
// fit the board instead of overflowing, which hides the very overflow we want to report.
export const BOARD_CSS = '[hidden]{display:none !important}[data-board-root]>*{flex-shrink:0}';

// Root wrapper style. Flex column + border-box gives predictable heights (Paper does the same).
//   fixed: the board is exactly its height, extra content overflows (and is clipped by the frame).
//   fit:   the board's height is a minimum; the wrapper grows with its content (min-height, not height).
export const boardRootStyle = (fit: boolean) =>
  `position:relative;display:flex;flex-direction:column;box-sizing:border-box;width:100%;${fit ? 'min-height:100%' : 'height:100%'}`;

export const boardRoot = (fit: boolean, html: string) => `<div data-board-root="" style="${boardRootStyle(fit)}">${html}</div>`;
