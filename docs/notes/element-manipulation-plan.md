# Element manipulation plan (Figma / Paper-style selection, moving, Design tab)

Written 2026-10-25. Status: **all 5 phases done (2026-10-25 / 26).** Kept as a record of what exists and its gotchas.

## Where we start (state on 2026-10-25)
- Selection is one id: `engine.ts` `selected: string | null`, pushed to zustand `store/canvas.ts` `selected` via `events.onSelect`,
  posted to the server as canvas action `selection` (which already takes `ids[]`, so `get_selection` already supports many).
- A click selects the **deepest** node under the pointer (`onDown` in `engine.ts`, `node` from the composed path).
- Dragging moves only absolute/fixed nodes (`CanvasEditor.dragNode` in `edit.ts` returns false for flow nodes, `isAbs`). Generated
  designs are mostly flex, so in practice nothing moves.
- Resize: 8 handles for boards / absolute nodes, e/s/se for flow nodes (`showHandles`, `beginResize`).
- Inspector (`panels/InspectorPanel.tsx`): CSS property rows (`SECTIONS`), one `style` action per field, single node only.
- Server pieces we can reuse: `Doc.moveNode(id, target, before|after|start|end)` (canvas action `move-node`),
  `Doc.updateStyles(ids, styles)` (action `style`, many ids, one undo step), `duplicate`, `delete` (both take `ids`).

## Interaction model we are aiming for (what Figma / Paper do)
- **Context scoping:** a click selects the top-most child of the current *context* (the board at first), not the deepest node.
  Double-click enters the selected node (its children become the context). Ctrl+click (Cmd on mac) selects the deepest node directly.
- **Two kinds of move:** inside an auto-layout (flex/grid) parent a drag **reorders** (and can drop into another container);
  an absolute node moves freely with **snapping and smart guides**.
- **Multi-selection everywhere:** Shift+click, marquee, Ctrl+A; one bounding box; the Design tab shows shared values and "Mixed".

---

## Phase 1: selection model
Status: **done 2026-10-25** (browser-checked at 42% live and 22% bitmap zoom; marquee on a board background not exercised, see below).

Summary: engine `selected: string[]` (last = primary) + derived `context`; pure logic in `web/src/canvas/selection.ts`
(`pickInChain`, `pickDeep`, `enterTarget`, `normalize`, `unionBox`, `siblingStep`, `rangeIds`; tests `test/selection.test.mjs`).
Click = top-level child of context, double-click enters (or edits a text leaf), Ctrl/Cmd+click deepest, Shift toggles, marquee on empty
space (boards when started outside any board), Enter / Shift+Enter or `\` / Tab / Ctrl+A / Esc, Delete / Ctrl+D / Ctrl+C / Ctrl+X on the set,
union box + per-member outlines (`.dc-members`), Layers panel Shift range / Ctrl toggle, hover follows the pick rule, selection posted with all ids.
Follow-up fixes 2026-10-26 (browser-checked on "Manipulation QA"; marquee on a wrapped board not exercised in the browser, only unit-tested):
- **Picking rule:** a node that is the only element child of its parent (board root or context) is a transparent wrapper. Plain click, hover, double-click-enter (`pickInChain` / `enterTarget` with `isSole`), marquee, Ctrl+A and Enter (`soleDescent`) skip such wrappers and descend until a node has siblings or is the hit itself. The wrapper stays reachable via Ctrl+click on its padding, Layers, Shift+Enter / Esc (parent). Layers shows the full tree on purpose.
- **Native text selection:** `engine.onMouseDown` cancels `mousedown` (pointerdown cannot) on the move tool except inside a contenteditable, blurs an active editor by hand, and `select()` clears stale ranges unless editing.
Gotchas for later phases
- Context is derived: it is the parent node of the primary (null for a top-level node), so `select(ids)` needs no context bookkeeping.
- `RectEntry.parent` (rects.ts) lets snapshot boards build the same ancestor chain as live ones (`chainAt` vs `chainOf`); a zero-size parent breaks the walk.
- Engine owns `dblclick` now (`onDblClick`); the editor only exposes `editText(el)`. `lastDown.chain` replaces the old `noteDown` for pointer-capture retargeting.
- `CanvasEditor.remove/duplicate/copy` take id arrays; engine `remove()/duplicate()/copy()` act on the selection (context menu uses them).
- Multi-select resize handles are hidden and `dragNode` still moves only the pressed node (phase 3). Pressing a member of a multi-set keeps the set; a click without drag narrows to it.
- After every doc render, selected ids that no longer exist are dropped (undo/delete would otherwise leave a ghost selection).
- Empty-space left drag is now a marquee, not a pan (Space / hand tool / middle mouse pan). Not exercised: marquee started on a board background with a context (test boards cover the whole frame), and `get_selection` through MCP (POSTs verified in the network log, the MCP session was bound to another project).

---

## Phase 2: moving nodes in flow (reorder / reparent)
Status: **done 2026-10-25** (browser-checked at 48%, 89%, 108% and 267% zoom with a scratch project, driven by synthetic pointer events).

Summary: pressing a flow node (not absolute, not locked) and dragging > 3 px runs `CanvasEditor.dragFlow` (`edit.ts`): original dims to 0.35,
ghost clone(s) follow in the overlay (`.dc-ghost`, max 6), blue 2 px `.dc-dropline` between siblings, `.dc-dropbox` outlines a target container other than
the original parent. Release sends ONE `move-nodes` (`{ids, target, position, copy}`, Alt = copy); no-op drops send nothing; Esc cancels (capture-phase
listener). Arrow keys reorder the selection along the parent's axis (`arrowReorder`). The whole selection moves when the pressed node is in it.
Pure maths in `web/src/canvas/dragflow.ts` (`inferAxis`, `insertionIndex`, `insertionLine`, `resolveDrop`, `stepDrop`, `inEdgeBand`; tests
`test/dragflow.test.mjs`). Server: `Doc.moveNodes(ids, target, position, {copy})` (one checkpoint, all checks before any change, document order kept,
`moveNode` now calls it), canvas action `move-nodes` in `USER_EDITS`; tests in `test/doc.test.mjs`.
Gotchas for later phases
- Axis is inferred from the children's boxes, not CSS (so block, flex and grid share one rule); `row-reverse` / `column-reverse` come out as 'flow' and are not handled specially.
- Dropping into a sibling container needs the pointer in its middle (outer 28% along the axis = "next to it", `inEdgeBand`) plus a 150 ms dwell, otherwise reordering a row of cards would dive into each card. Dwell re-checks on a timer because a still pointer sends no events.
- The drop target comes from `engine.nodesAt` (`shadow.elementsFromPoint`); only live (mounted) boards accept drops, bitmap boards (zoomed out) fall through to pan. Reference boards refuse.
- `canHold` rejects img / svg / controls / button / text-bearing nodes / display:contents / inline; the board's `[data-board-root]` is the container for top-level nodes (target = board id).
- Grid items with explicit grid-column / row / area only change DOM order; a toast says so.
- Alt copy mints fresh ids server-side and does not change the selection (the copies are not selected).
- Arrow keys skip absolute nodes on purpose: phase 3 owns their nudge. The arrow handler returns true on a key across the axis only when it acted, so other arrow uses stay free.
- Not exercised: drag across two boards, real mouse drags (only synthetic pointer events were available in the browser tool), touch.

---

## Phase 3: free move, snapping, smart guides, nudge, better resize
Status: **done 2026-10-25** (browser-checked at 40%, 47% and 54% zoom with a scratch project, synthetic pointer / key events).

Summary: pure maths in `web/src/canvas/snap.ts` (`snapMove`, `snapResize`, `annotate`, `gapPills`, `measure`, `resizeBox`, `scaleInto`, `unionOf`; tests `test/snap.test.mjs`)
works in "client px / zoom" space so nodes and boards compare directly; `guides.ts` `Guides` draws red-pink lines, gap segments and number pills in the overlay
(`.dc-guide/.dc-gap/.dc-pill`, one layer, rebuilt per move). `CanvasEditor.dragNode` moves the whole selection of absolute nodes (union box snaps to siblings + parent,
equal spacing both between two neighbours and by extending an existing gap), `dragBoard` snaps to other boards, `beginResize` works on the union box for one or many nodes and boards.
Ctrl = no snap, Shift = axis lock (move) / ratio (resize, snapping off), Alt = from centre (resize, snap mirrored), Alt+hover = measure (engine `onPointerMove` -> `editor.measure`).
Arrows nudge absolute nodes 1 / Shift 10 px: live preview, saved on keyup (700 ms fallback timer, flushed before undo and on pointerdown) as one action. Server: `Doc.updateStyles(ids, styles, perId)`
and canvas `style` accept `perId` (`{id: {prop: value}}`, merged over `styles`), one checkpoint, test in `test/doc.test.mjs`. The existing `.dc-size` pill is the live W x H.
Gotchas for later phases
- Shift+press on a node toggles selection (no drag), so Shift axis lock only works when Shift is pressed mid-drag.
- Pills only appear once something lines up (a guide or equal marks), otherwise they flicker; Alt-measure draws them unconditionally.
- Snapping with Shift-resize is skipped on purpose (the ratio wins); with Alt the dragged edge's snap gain is mirrored on the opposite edge.
- Nodes using `right` / `bottom` instead of left / top are not handled (as before); flow nodes keep e/s/se handles (no Fill->Fixed switch yet, that is phase 4).
- Multi-resize needs every member absolute and live; mixed or bitmap selections hide the handles. Resize reads `offsetWidth` (border box), so content-box nodes with padding will jump (pre-existing).
- A 700 ms-pending nudge is invisible to other clients until it saves; synthetic key events in tests need a `keyup`.
- Not exercised: real mouse / Alt key (Windows may focus the menu on a lone Alt press), snapping across boards for nodes (only same-parent siblings), touch.

---

## Phase 4: Design tab redesign
Status: **done 2026-10-25** (browser-checked in dark theme with a scratch project; light theme and real mouse scrubs not exercised).

Summary: `InspectorPanel.tsx` now only routes; sections live in `panels/inspector/` (see CLAUDE.md "Inspector"). Selection of many nodes is edited together (`Model.get` -> shared value or "Mixed",
one `style` action, per-node values via `perId`). Sections: align bar (absolute nodes get left/top deltas from measured boxes, flow children get `align-self` / parent `justify-content`, distribute =
even gaps for 3+ absolute or `space-between` in a flex parent), Position (X/Y/rotation, "Absolute" toggle keeps the offset, makes the parent `position:relative`), Size (Fixed/Hug/Fill per axis via
`sizeMode`/`sizeCss`, min/max under "+"), Auto layout (on/off, direction, wrap, 3x3 grid, space-between, gap, padding H/V -> 4 sides), Appearance (opacity %, radius -> 4 corners, clip), Fill / Stroke / Effects,
Typography (icon text-align), Other styles (single selection only). `NumberField`: scrub label (Shift x10, Alt /10, live preview, one undo on release), arrow bursts = one undo step, arithmetic (`evalExpr`).
`ColorField` opens an OKLCH popover (L, C, H, alpha sliders, colour tokens): sliders preview live, commit on release.
Gotchas
- Size mode is derived from INLINE styles of the node and its parent (generated designs are inline), with the board root treated as a flex column (`BOARD_PARENT`). Absent width in a block parent reads as Fill, absent height as Hug.
- Live preview writes inline style on the live element and remembers originals; a real edit just forgets them (the doc render replaces the node), a cancel restores. Bitmap (zoomed-out) boards have no live element: previews are skipped and `measure` returns null (align / absolute toggle then toast "zoom in").
- `ColorRow` keys must not include the value, or a commit remounts the field and closes the popover.
- A hidden fill is stored as `--dc-hidden-fill` (CSS has no per-fill visibility). Per-side borders and gradients stay as raw text / Other styles; only one fill and one stroke are modelled.
- Top-level nodes cannot align on the board's main (vertical) axis through flex (their parent is the board wrapper, not a layer): toast says so; use Absolute.
- Not done: constraints, multi-fill lists, per-axis min/max scrub (plain text), Other styles for multi-selection.

---

## Phase 5: polish and structure
Status: **done 2026-10-26** (browser-checked on a scratch server: group / ungroup / add auto layout, undo, fit regrow, drag hints, shortcuts dialog; light theme glanced, dark theme used throughout; real mouse drags not available, synthetic pointer events only).

Summary: `Doc.wrapNodes(ids, {styles, perId, name})` (siblings only, document order, wrapper takes the first node's place, one undo step) and `Doc.unwrapNode(id, {perId})`;
canvas actions `wrap` / `unwrap` (in `USER_EDITS`, results returned so the browser selects the wrapper / freed children) and `grow`. The browser measures, pure `web/src/canvas/structure.ts`
(`planWrap`, `planUnwrap`, `measureGap`; tests `test/structure.test.mjs`) decides styles: flow nodes -> flex wrapper (direction from `inferAxis`, median gap), absolute nodes ->
absolute wrapper over the union box (Ctrl+G, children re-based) or absolute flex wrapper with freed children (Shift+A). Keys in `CanvasEditor.onKey`: Ctrl+G, Ctrl+Shift+G / Ctrl+Alt+G, Shift+A;
context menu has Group / Add auto layout / Ungroup / Keyboard shortcuts; `shell/ShortcutsDialog.tsx` (top-bar button or ?) lists every shortcut (keep it in sync). Drag in flow now draws
`.dc-hints` (container outline, dashed siblings, shaded padding and gaps; `CanvasEditor.drawHints`). Fit boards: `Board.growObs` ResizeObserver on the live root -> `grow` action after a user edit.
Gotchas
- Flow and absolute nodes cannot be wrapped together (toast); wrapping needs a live (zoomed-in) board; ungroup is single-node only.
- A child's own margins plus the measured gap can double the spacing (gap is measured from border boxes).
- `selectNew` / `selectWhenReady` polls with setTimeout, not rAF (rAF is paused in a hidden tab, e.g. the Browser pane when not shown) and accepts an id once `pidIndex` has it.
- The regrow only fires within ~1.5 s of `markUserEdit`; Claude's writes keep the server-side measure path. It never shrinks (use `fit_artboard`).
- Agent tints / signal blue untouched; hint colours are a light wash of `--dc-accent`.

## Out of scope for now
Rotation handles on the canvas, vector boolean ops, constraints (left/right/scale) for responsive resize, components overrides UI.
