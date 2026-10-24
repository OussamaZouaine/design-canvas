// The design guide the MCP serves through get_guide({ topic }). It lives in the server (not only in the
// Claude Code skill) so every MCP client gets the same process and taste rules, with no plugin installed.
// Topics are small on purpose: an agent loads only what the current step needs, which keeps tokens down.
// All colours are OKLCH to match the project rules. Wording is our own; the ideas (mood from a scene,
// restraint, a review loop) are common design practice.

const WORKFLOW = `Design Canvas workflow (this one call also contains the brief, type, layout and review rules below, so you do not need to fetch them separately; only "mobile" and "svg" (icons, logos, illustrations) are on demand). Every turn re-reads the whole conversation, so use few turns: send independent tool calls together in ONE turn (for example get_guide + start, or several write_html calls for different boards).
0. START. Call get_guide, and in the same turn start({prompt, project, description?, brief?, artboard?}). project is a short (2-4 word) name from what you are building (the repo, product or feature, e.g. "Checkout redesign") or a project id; an existing one is reused, otherwise it is created. Never create a second project for the same work. start resolves the project, logs the request (prompt: the user's own words, one short sentence) and can create the first board (artboard, with html for the first group) in ONE call. Pass the returned project_id on every later call so parallel sessions don't mix up projects. list_projects is only for browsing when you do not know the name.
0b. BRIEF. For a NEW design pass brief (mood, palette, type, direction: see get_guide topic "brief") to start and post the same brief in chat before the first write. It is stored with the project so later sessions know the intent. Later requests in the same project: log_prompt (or start again).
1. start already returns an existing project's open comments, the user's hand changes and its artboards, so do not call get_comments, get_changes or get_basic_info first; use get_tree for an outline (query finds a node by name or text). A project start just created is empty: go straight to the first board.
2. create_artboard WITH html for the first group (or start's artboard), then write_html for the next groups. Add roughly one visual group (header, hero, card row) per call, and review it (topic "review") before the next.
3. Style with inline style attributes only. No <script>, <link> or event handlers: they are stripped. Layout rules: topic "layout".
4. Every element gets a stable id (data-pid). Use get_tree to see ids, then update_styles / set_text_content / delete_nodes to refine instead of rewriting. Repeat a block with <x-clone node-id="N5"></x-clone> in write_html; history (undo) reverts a bad change. Nodes marked data-locked can't be edited. find_nodes locates nodes by text, name, tag, component or style value (cheaper than reading a tree); export_code (format jsx) gives React+Tailwind for one node; export writes a PNG of a board or node to disk.
4b. BATCH: when you have 3 or more independent edits (restyle several nodes, rename + move + duplicate, a few write_html into different parents), send them as ONE batch({ops:[{tool,args},...]}) instead of one turn each. Allowed: write_html, update_styles, set_text_content, rename_nodes, duplicate_nodes, delete_nodes, move_node, set_flags, insert_component, create_artboard. It stops at the first error (earlier ops stay applied; history undo reverts), runs the layout check once at the end and does not lint per op, so finish with a get_screenshot review. Ids created by an earlier op are not known until the result: do not batch an edit that needs them.
5. LAYOUT: boards default to height_mode fit (height is a minimum, the board grows with its content). write_html / update_styles add a "layout" line to their result when something does not fit; check_layout measures real boxes on demand; fit_artboard fixes a clipped board in one call. Never delete and rebuild a board for an overflow. finish_working refuses to finish while content is clipped.
5b. write_html / update_styles / create_artboard already add a "lint" line when a change introduces NEW lint issues (silent otherwise): fix those. Call lint separately only for a full pass over a board before finishing. Then one get_screenshot with review:true (lint + layout problems + image in one call) to critique the result (needs the project open in the browser). To look and finish in one turn, call finish_working with screenshot_artboard_id. Stop after 3 fix rounds or when lint is clean.
Fonts: list_fonts, then use_font for a Google Font before styling with it (see topic "type").
Colour: write colours as oklch(L C H), e.g. oklch(0.62 0.19 262) for a blue, oklch(0.98 0.004 90) for a warm off-white. OKLCH keeps lightness perceptually even, so ramps and contrast are predictable; for gradients use linear-gradient(in oklch, ...).
Feedback: the user can pin comments on elements. In an existing project call get_comments at the start of a task; fix what open comments ask, then reply_comment with resolve: true (one call per comment; resolve_comment alone only to resolve or reopen without a reply). A project you just created has none, so skip it.
Consistency: call tokens (action extract) before adding pages to an existing design, and reuse its colours, type sizes, radii and spacing.
Safety net: the app auto-saves version history, so a bad generation can be rolled back from the History panel.
On demand: topic "mobile".`;

const BRIEF = `Brief (do this before the first write_html of a new design; post it in chat, then pass it as log_prompt.brief):
1. Mood. List three candidate moods, then pick one that is NOT your first instinct. A mood is a place or material ("quiet pharmacy at 7am", "oxidised copper roof"), not an adjective like "modern and clean".
2. Palette from a scene. Name 3-5 physical objects in that scene and take colours from them. Give each colour a role: ground, surface, ink, muted ink, one accent, one status set. Write them as oklch(L C H). Hold C and H and step L to build a ramp.
   - Pure white (oklch(1 0 0)) is the normal ground. Use a tinted off-white (C 0.004-0.012) only when the mood asks for it.
   - Neutrals carry a trace of the accent hue (C about 0.005-0.02) so they sit together; never a flat grey beside a saturated accent.
   - One intense colour moment per screen (a button, a number, a hero block). Everything else stays quiet.
   - Pairings that read as real: deep green ground + warm cream ink; slate + oxidised-copper accent; limestone + ink-black + one terracotta; near-black + a single signal yellow.
   - Pairings to avoid: purple-to-blue gradients on white, neon on near-black "tech", rainbow chart palettes, a different accent per card, pastel + pastel.
3. Type scale. Pick one display size and a small ladder (for example 12 / 14 / 16 / 20 / 32 / 56). See topic "type".
4. Register. Product UI: clarity first, dense and calm, one accent. Portfolio or marketing: impressive, big type, asymmetry, whitespace. Consumer or kids: playful shapes and colour, but contrast rules still hold.
5. One sentence of direction that a stranger could use to say "yes, that matches" or "no, it doesn't".
Restraint: fewer elements than your first draft. Put content on the page surface instead of wrapping everything in cards; use scale contrast and alignment before borders and shadows. Real, specific content only (real names, numbers, dates), never lorem ipsum.
Non-negotiable: text contrast at least 4.5:1 (3:1 for 24px+ or bold 19px+), minimum text size 12px, touch targets at least 40px on mobile.`;

const TYPE = `Type:
- Fonts: only use a system stack (system-ui, -apple-system, "Segoe UI", sans-serif; ui-serif, Georgia, serif; ui-monospace, Menlo, monospace) or a family you loaded. Call list_fonts to see what exists, then use_font({family, weights}) for a Google Font (ask for every weight you will use) and paste the css value it returns. Any other name silently falls back to the next family, and lint flags it. A pairing is one display face plus one text face at most; the system stack is a fine default for product UI.
- Contrast of weight and size does the work: a heavy display line (700-800) next to light small labels (400-500) beats a uniform mid-weight page. Use 2 weights per board, 3 at most.
- Tracking: tighten large type (-0.02em to -0.04em above 32px), keep body at 0, open tiny uppercase labels (+0.06em to +0.12em at 11-12px).
- Line height: 1.05-1.15 for display, 1.4-1.5 for body, always unitless or px. Keep lines at 45-75 characters.
- Use tabular numbers (font-variant-numeric: tabular-nums) for any column of figures.
- One display moment per screen. Do not set three headings of similar size.`;

const LAYOUT = `Layout dialect (keeps boxes predictable so nothing is cut off):
- Flex + padding + gap. Every element is box-sizing: border-box. Prefer gap over margins; avoid margin entirely, and avoid display: inline, tables and absolute positioning for normal flow (absolute is fine for badges and overlays).
- CSS grid works but widths are harder to predict; use it for true 2D grids only and give tracks explicit sizes (repeat(3, 1fr) inside a fixed-width parent).
- Every board root is already a flex column. Give sections width: 100% and let children wrap with flex-wrap or stack with a gap.
- Boards are height_mode fit by default: height is a minimum and the board grows. If content is clipped, call fit_artboard instead of guessing a taller pixel value. Use fixed only for exact device mockups.
- Repeated rows (lists, navs, tables): give icons and trailing actions a fixed-width slot (width + flex-shrink: 0) so columns line up across rows; gap alone will not align them. Let the text cell take flex: 1 and min-width: 0.
- Text that must not push its container wider: min-width: 0 on the flex child, plus overflow-wrap: anywhere or text-overflow: ellipsis with overflow: hidden and white-space: nowrap.
- Spacing sits on a 4px grid (8 / 12 / 16 / 24 / 32 / 48 / 64). Related things are closer together than unrelated things.
- Sizes: phone 390x844, tablet 768x1024, desktop 1440x900.`;

const REVIEW = `Review loop (after each section, not only at the end):
Take one get_screenshot of the section, then write ONE line verdict on each checkpoint, fix what fails with a targeted update_styles / write_html on the parent id, and continue:
1. Spacing: rhythm on the 4px grid, related items grouped, no cramped or floating blocks.
2. Typography: clear hierarchy, sizes from the scale, nothing under 12px, line lengths sensible.
3. Contrast: text at least 4.5:1 on its real background (run lint), status text uses the dark "ink" variants.
4. Alignment: edges line up across rows and sections, icon and action columns are fixed-width slots.
5. Artboard fit: no "layout" warning, no clipped or overflowing content (check_layout). A fit board grows by itself; a fixed board needs fit_artboard.
6. Repetition: no three identical cards in a row that could be a list, no copy-pasted placeholder text.
Stop after 3 fix rounds per section. Never delete and rebuild a board to fix one problem.`;

const MOBILE = `Mobile screens:
- Artboard 390x844. Use height_mode fixed (844) for a device mockup, fit for a long scrolling screen.
- Status bar: a 47px-tall flex row, padding 0 24px, space-between; left a time like "9:41" at 600 weight 16px, right a small battery/signal group built from rounded divs. Keep it identical on every screen of the flow.
- Safe areas: 47px top, 34px bottom (home indicator: a 134x5px pill, radius 3px, centred, 8px from the bottom).
- Bottom tab bar: 83px tall including the safe area, 3-5 items, icon over a 11-12px label, active item in the accent colour only.
- Touch targets 44px minimum; body text 16-17px; side padding 16-20px.
- Lists: fixed-width leading slot (40-44px) and trailing slot so rows align.`;

// On demand like "mobile": only designs with icons, logos or illustrations need it.
const SVG = `Vectors and SVG (icons, logos, illustrations, charts):
- Write inline <svg> in write_html like any other markup. Always set viewBox, plus width/height (or a CSS size) so it scales; use preserveAspectRatio only when the default is wrong.
- Icons: 24x24 viewBox, stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round", so the icon takes its colour from the parent's CSS color. Keep one stroke width across a set.
- Colours in fill/stroke are oklch(...) or currentColor or var(--token); never hex. Gradients: define <linearGradient id="..."> inside the same svg and reference it as fill="url(#id)"; give ids a unique prefix per svg because several svgs share one page.
- Not allowed (stripped on write): <style>, <script>, <foreignObject>, <use>/<image> pointing outside the file, remote url(), event handlers. Style with attributes or inline style="" instead. <image> only takes data:image/png|jpeg|gif|webp;base64.
- Edit an existing vector with set_attrs on the child node id (d, fill, stroke, stroke-width, transform, cx/cy/r, viewBox...; null removes). update_styles is for HTML/CSS properties only. get_tree with depth 3 or more lists the svg children (path, circle, g... with their d/fill/stroke) so you can target a single shape.
- import_svg places an SVG you already have (markup in svg, or file inside the repo linked with tokens link_repo); each shape becomes an editable node. Name the root with name.
- A path the user drew with the Pen tool is `<svg data-shape="path">` holding one `<path>`; get_tree shows `path:<id> d:...` on the svg line, so set_attrs the d on that path id. The svg box and viewBox are fitted to the path when the user edits it, so after you change d, keep the viewBox/box big enough (or set overflow visible, which is the default).
- Text inside an svg inherits font-family from the board; set text-anchor/dominant-baseline with set_attrs to align it.
- Review the result with get_screenshot: thin strokes and tiny viewBoxes are the usual defects.`;

// `start` is the whole method in one call: each get_guide call costs a full agent turn, and the evals showed
// agents spending three of them reading brief / type / layout one by one. The single topics stay for lookups.
const START = [WORKFLOW, BRIEF, TYPE, LAYOUT, REVIEW].join('\n\n');
export const TOPICS = { start: START, brief: BRIEF, type: TYPE, layout: LAYOUT, review: REVIEW, mobile: MOBILE, svg: SVG };

// Unknown topics return the topic list instead of an error, so an agent can recover in one call.
export function guideText(topic = 'start') {
  const key = String(topic).toLowerCase();
  return TOPICS[key] ?? `Unknown topic "${topic}". Topics: ${Object.keys(TOPICS).join(', ')}.`;
}

// The default guide, kept as its own export because the server's `instructions` and tests refer to it.
export const GUIDE = START;
