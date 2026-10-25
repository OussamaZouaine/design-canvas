# Element manipulation plan (Figma / Paper-style selection, moving, Design tab)

Written 2026-10-25. Status: phases 1-3 done, 4-5 not started. One phase per session, in order (phases 2-5 need phase 1).
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
