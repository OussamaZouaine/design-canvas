# Element manipulation plan (Figma / Paper-style selection, moving, Design tab)

Written 2026-10-25. Status: **plan only, nothing built**. One phase per session, in order (phases 2-5 need phase 1).
Update the "Status" line of each phase when it is done and collapse finished phases to 2-3 lines.

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
Status: not started. Needs phase 1.

Goal: drag any flow node (child of block / flex / grid) to a new place among its siblings or into another container,
like Figma auto layout.

Behaviour
- Drag threshold 3 screen px (as today). The dragged node gets a ghost (semi-transparent clone in the overlay, screen px) and the
  original is dimmed in place; we do **not** live-reflow the DOM during the drag (cheap, no layout thrash, no undo noise).
- Drop target = the deepest container under the pointer that is not the dragged node or inside it, not locked, and can hold
  children (not an img / svg / text leaf). Default is the current parent; moving into another container requires the pointer to
  be inside it (Figma also waits a short dwell, ~150 ms, before reparenting; do the same to avoid accidental jumps).
- Insertion index: from the container's direction (`flex-direction` row/column, block = column, grid = reading order) compare the
  pointer with the midpoints of the children. Draw a 2 px signal-blue insertion line between the two siblings and outline the target container.
- Release: one `move-node` (`before`/`after` a sibling, or `start`/`end` of an empty container). No-op when the index did not change.
- Multi-selection: all selected nodes move together, keeping their order. Needs a server change (below).
- Alt while dropping = copy instead of move (duplicate + move, one undo step).
- Esc during drag cancels.
- Keyboard: in a flow parent, arrows reorder along the parent's axis (left/up = earlier). Absolute nodes keep nudge (phase 3).
- Absolute nodes keep today's free drag; dragging an absolute node onto another container does not reparent (Figma: Ctrl-drag reparents; later).

Server
- `Doc.moveNodes(ids, targetId, position)`: one `_checkpoint('move_nodes')`, moves in document order so relative order is kept,
  same checks as `moveNode` (locked, own descendant, board target needs start/end). Canvas action `move-nodes`; keep `move-node`
  for the Layers panel (or make it call `moveNodes([id])`). Add to `USER_EDITS`. Tests in `test/doc.test.mjs`.

Code
- New `web/src/canvas/dragflow.ts` (pure: given child rects + axis + pointer -> index; unit test like `test/path.test.mjs`,
  DOM-free and import-free) and the pointer handling in `edit.ts` (`dragNode` falls through to `dragFlow` for flow nodes).

Done when
- Reorder cards in a flex row and items in a column list, move a button into another card, multi-move three items: each is one undo step.
- Ghost and insertion line are correct at zoom 0.5, 1 and 3, and on a board scrolled far away. `pnpm test` green.

Gotchas
- `display: contents` / wrappers without a box: skip them when computing child rects.
- Grid with explicit `grid-column` placement: reorder still changes DOM order only; warn in a toast if placement is explicit.
- Moving between boards works server-side (`moveNode` is cross-artboard); allow it only when the pointer is over another board.
- `markUserEdit()` before sending, so the canvas does not play the "Claude is designing" reveal.

---

## Phase 3: free move, snapping, smart guides, nudge, better resize
Status: not started. Needs phase 1.

Goal: precise placement of absolute nodes (and boards) the way Figma does it.

Snapping
- Candidates: edges and centres of the dragged box vs. siblings (same parent) and the parent's content box; for boards, other boards.
- Threshold 5 screen px (divide by zoom for design px). Snap each axis independently to the nearest candidate.
- Guides: 1 px red-pink lines across the matched edges + distance pills (e.g. "24") between the box and its neighbours.
  Equal-spacing detection (Figma's pink "=" marks) when the gap to two neighbours matches.
- Hold Ctrl while dragging to disable snapping. Pure maths in `web/src/canvas/snap.ts` (DOM-free, unit-tested).

Move and nudge
- Shift during drag locks to the dominant axis. Arrows nudge 1 px, Shift+arrow 10 px, applied to all selected absolute nodes
  as one `style` action (coalesce held keys: send on keyup or after 300 ms idle so one burst = one undo step).
- Multi-drag of several absolute nodes (one `style` action with per-id left/top, needs `style` to accept a per-id map:
  add `styles: { [id]: {...} }` form to the canvas action, or a `batch-style` action).
- Alt + hover while a node is selected: show distances from the selection to the hovered node / parent edges (measure mode).

Resize
- Shift keeps the aspect ratio, Alt resizes from the centre; snapping applies to the moving edges.
- Multi-resize: scale every selected absolute node inside the union box (left/top/width/height), one undo step.
- Live W x H pill under the box while resizing.
- Flow nodes: keep e/s/se handles; dragging a handle of a node whose width is "Fill" switches it to Fixed (see phase 4).

Done when
- Dragging a shape snaps to sibling centres with visible guides and distances; nudges and multi-drags are single undo steps.

---

## Phase 4: Design tab redesign
Status: not started. Needs phase 1 (multi-select values); phase 2 makes the auto-layout controls more useful.

Goal: replace the CSS-property list with Figma-like sections that map to CSS. Raw CSS stays reachable under "Other styles".

Sections (top to bottom)
1. **Align bar**: align left / centre / right / top / middle / bottom and distribute (for 2+ absolute nodes: computes left/top;
   for flow children: sets the parent's `align-items` / `justify-content` or the child's `align-self`).
2. **Position**: X, Y (absolute only; for flow nodes greyed with an "Absolute position" toggle that sets `position:absolute`
   with the node's current offset, like Figma's "Ignore auto layout"), rotation (`rotate`), and constraints later.
3. **Size**: W and H each with a mode menu **Fixed / Hug / Fill**:
   Fixed = `width:Npx`; Hug = `width:fit-content` (or remove width); Fill = `flex:1 1 0` in the parent's main axis,
   `align-self:stretch` on the cross axis, `width:100%` in a block parent. Min / max width/height in a "+" menu.
   The mode is derived from the computed style + parent display (put that logic in a pure helper, unit-tested).
4. **Auto layout**: on/off (display flex vs block), direction toggle (row / column / wrap), a 3x3 alignment grid that sets
   `justify-content` + `align-items` together, a "space between" toggle, gap, padding as horizontal / vertical with an
   expand-to-four-sides button (reuse the existing per-side padding control).
5. **Appearance**: opacity, radius (with per-corner expand), overflow "Clip content" checkbox.
6. **Fill**: list of fills (background colour / gradient), OKLCH colour picker popover (L, C, H sliders + alpha + token list),
   eye toggle per fill. **Stroke**: colour, width, style, inside/outside (border vs outline). **Effects**: shadow list.
7. **Typography**: font (existing `FontField`), size, weight, line height, tracking, alignment as icon buttons, colour.
8. **Other styles**: unchanged.

Field behaviour
- **Scrub labels**: drag the field label left/right to change a number (Shift = x10, Alt = /10), sends on release (one undo step),
  previews live by writing to the element like resize does.
- Arrow up/down in a number field steps by 1 (Shift 10). Expressions allowed (`16*2`).
- **Multi-select**: show a value when all selected nodes share it, else "Mixed"; editing sets it on all (one `style` with `ids`).
- Token suggestions stay (`var(--token)`), shown as a token chip in the field.

Code
- Split `InspectorPanel.tsx` into `panels/inspector/*` (one file per section) once it grows; shared fields live in `web/src/ui/`.
- Follow `docs/notes/ui-system.md` (graphite surfaces, `bg-field`, signal blue = selection only) and the motion rules.

Done when
- A card can be switched to Hug/Fill, its children aligned with the 3x3 grid, its padding scrubbed, all with undo working,
  and editing two selected buttons at once works. Browser-checked; `pnpm test` green.

---

## Phase 5: polish and structure
Status: not started.
- Group / ungroup: Ctrl+G wraps the selection in a new flex div (direction guessed from the nodes' layout), Ctrl+Shift+G /
  Ctrl+Alt+G unwraps (server: `Doc.wrapNodes` / `Doc.unwrapNode`, one undo step, tests).
- "Add auto layout" (Shift+A): wraps the selection in a flex container with gap measured from the current spacing.
- Hover hints while dragging: outline of the parent and siblings, padding / gap areas shaded (Figma's auto-layout overlay).
- Selection colours per agent stay as today (`setAgentIds`); user selection stays signal blue.
- Context menu entries for all of the above; shortcuts listed in the help dialog.
- Fit boards: re-measure after user moves / resizes (the Phase A leftover ResizeObserver in PROGRESS.md item 0).

## Out of scope for now
Rotation handles on the canvas, vector boolean ops, constraints (left/right/scale) for responsive resize, components overrides UI.
