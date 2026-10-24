// Server copy of web/src/canvas/contract.ts (used by export_code html). The web app cannot import from src/ and
// the server cannot import TypeScript, so the strings are repeated; test/contract.test.mjs keeps them equal.
export const BOARD_CSS = '[hidden]{display:none !important}[data-board-root]>*{flex-shrink:0}';

export const boardRootStyle = (fit) =>
  `position:relative;display:flex;flex-direction:column;box-sizing:border-box;width:100%;${fit ? 'min-height:100%' : 'height:100%'}`;

export const boardRoot = (fit, html) => `<div data-board-root="" style="${boardRootStyle(fit)}">${html}</div>`;
