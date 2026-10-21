// The design guide the MCP serves through get_guide({ topic }). It lives in the server (not only in the
// Claude Code skill) so every MCP client gets the same process and taste rules, with no plugin installed.
// Topics are small on purpose: an agent loads only what the current step needs, which keeps tokens down.
// All colours are OKLCH to match the project rules. Wording is our own; the ideas (mood from a scene,
// restraint, a review loop) are common design practice.

const WORKFLOW = `Design Canvas workflow (this one call also contains the brief, type, layout and review rules below, so you do not need to fetch them separately; only "mobile" is on demand). Every turn re-reads the whole conversation, so use few turns: send independent tool calls together in ONE turn (for example log_prompt + create_artboard, or several write_html calls for different boards).
0. PROJECTS FIRST. Call list_projects. If one already matches the thing you are building, open_project it; otherwise create_project with a short (2-4 word) name taken from what you are working on (the repo, product or feature, e.g. "Checkout redesign"), plus a one-line description. Never create a second project for the same work. After create/open, pass the returned project_id on every later call so parallel sessions don't mix up projects.
0b. LOG THE REQUEST + BRIEF. At the start of every new user request, call log_prompt with the request in the user's own words (one short sentence). For a NEW design also pass brief (mood, palette, type, direction: see get_guide topic "brief") and post the same brief in chat before the first write. It is stored with the project so later sessions know the intent.
1. In an EXISTING project, get_basic_info to see its artboards and get_tree for an outline (query finds a node by name or text). In a project you just created there is nothing to read: skip both and go straight to create_artboard.
2. create_artboard, then write_html into it. Add roughly one visual group (header, hero, card row) per call, and review it (topic "review") before the next.
3. Style with inline style attributes only. No <script>, <link> or event handlers: they are stripped. Layout rules: topic "layout".
4. Every element gets a stable id (data-pid). Use get_tree to see ids, then update_styles / set_text_content / delete_nodes to refine instead of rewriting. Repeat a block with <x-clone node-id="N5"></x-clone> in write_html; undo reverts a bad change. Nodes marked data-locked can't be edited.
5. LAYOUT: boards default to height_mode fit (height is a minimum, the board grows with its content). write_html / update_styles add a "layout" line to their result when something does not fit; check_layout measures real boxes on demand; fit_artboard fixes a clipped board in one call. Never delete and rebuild a board for an overflow. finish_working refuses to finish while content is clipped.
5b. After meaningful changes call lint (text, cheap) and fix what it reports, then one get_screenshot to critique the result (needs the project open in the browser). Stop after 3 fix rounds or when lint says clean.
Colour: write colours as oklch(L C H), e.g. oklch(0.62 0.19 262) for a blue, oklch(0.98 0.004 90) for a warm off-white. OKLCH keeps lightness perceptually even, so ramps and contrast are predictable; for gradients use linear-gradient(in oklch, ...).
Feedback: the user can pin comments on elements. In an existing project call get_comments at the start of a task; fix what open comments ask, then reply_comment and resolve_comment. A project you just created has none, so skip it.
Consistency: call get_design_tokens before adding pages to an existing design, and reuse its colours, type sizes, radii and spacing.
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
- Fonts: use system stacks (system-ui, -apple-system, "Segoe UI", Inter, sans-serif; ui-serif, Georgia, serif; ui-monospace, Menlo, monospace). Custom fonts are not loaded, so naming one silently falls back.
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

// `start` is the whole method in one call: each get_guide call costs a full agent turn, and the evals showed
// agents spending three of them reading brief / type / layout one by one. The single topics stay for lookups.
const START = [WORKFLOW, BRIEF, TYPE, LAYOUT, REVIEW].join('\n\n');
export const TOPICS = { start: START, brief: BRIEF, type: TYPE, layout: LAYOUT, review: REVIEW, mobile: MOBILE };

// Unknown topics return the topic list instead of an error, so an agent can recover in one call.
export function guideText(topic = 'start') {
  const key = String(topic).toLowerCase();
  return TOPICS[key] ?? `Unknown topic "${topic}". Topics: ${Object.keys(TOPICS).join(', ')}.`;
}

// The default guide, kept as its own export because the server's `instructions` and tests refer to it.
export const GUIDE = START;
