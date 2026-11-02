# Editor cursor controls

On desktop the cursor controls are the **Cursor** section of the editor's Presentation panel (`editor.inspector.sections`, `core:cursor`); on phones they open from the editor's ⋯ menu (**Cursor options**). Order: Show cursor, Appearance, Colour, Motion, Size, Hide when idle, Click feedback, Reset.

## Research and scope

- [Screen Studio's cursor guide](https://screen.studio/guide/cursor) groups visibility, size and idle hiding together, with additional behavior behind an advanced disclosure. The inspector adopts that focused grouping and opens only when requested.
- [Recordly.dev](https://recordly.dev/) links to [webadderallorg/Recordly](https://github.com/webadderallorg/Recordly), the relevant open-source desktop recorder. Its cursor controls include overlay visibility, size, smoothing and click bounce. The inspector exposes the existing CUA press animation as click feedback.

There is **no installed CUA dependency or cursor asset pack** in package.json or the lockfile; upstream `@trycua/cursor-motion` is MIT-licensed but private (not on npm). `src/client/cursor-motion.ts` is a local MIT-licensed port, attributed to `@trycua/cursor-motion` at CUA revision `4b84caa4053bd86be7746c5527cee3d1626612ed` (per-file hashes in `.review-artifacts/cua-cursor-options-provenance.json`). It ports CUA's six trajectory styles and keeps the one arrow path from CUA Driver's `cursor-overlay/assets/build_default_theme.py`, on a 128-unit canvas with hotspot (55, 30). That arrow is CUA's only built-in artwork. The other appearances below are Replays' own drawings.

## Appearance (cursor themes)

Re-verified against trycua/cua `main` at `d5373879e9e0baf5a63999ac4d26902340c0ce20` (`libs/cua-driver/docs/cursor-themes.md`). CUA Driver ships one built-in theme, `cua.default`; custom themes are dotLottie archives with a `cua/theme.json` manifest (`cua.cursor-theme/2`, profile `cua-driver-actions-v2`: twelve action animations, 128 × 128 at 30 fps, at most 120 frames each and 1,000 in total, a hotspot and a reduced-motion `still_frame` per action). The libraries are MIT. Theme artwork carries only its author's declared `license` field, so Replays bundles no CUA or third-party theme assets.

**Appearance** sits above Motion. It is a radio group of themes from the `cursor.themes` slot (`src/client/cursor-themes.ts`). Each row's preview is the theme's real glyph, drawn by the player's renderer at 75 %. Selecting a row, or hovering it with a mouse, makes the glyph hop in and play its click feedback once; nothing plays on mount or under reduced motion.

| Id | Look | Click feedback |
| --- | --- | --- |
| `core:arrow` (default) | The CUA-style arrow, unchanged | ripple |
| `core:classic-arrow` | A desktop pointer drawn for Replays | ripple |
| `core:dot` | A small dot with a white rim | pulse |
| `core:ring` | A tinted ring around the point | pulse |
| `core:hand` | A pointing hand drawn for Replays | ripple |
| `core:agent` | A small arrow with a name tag: "Agent", or "Human" for human recordings (`meta.source`) | press (the existing squish) |

**Colour** is a swatch radio group: the style's own colours plus six token values (`CURSOR_COLORS` in `src/shared/cursor.ts`: the light and dark accents, success, the dark warning and danger hues, and light text). Tints are stored as names and drawn as fixed hex values, so an export never depends on the app's light or dark theme. Text on the agent tag is white or ink, whichever clears 4.5:1 on the swatch. Themes that keep their own artwork (CUA `.lottie`) disable the swatches and say so.

Click feedback is a pure function of the pose's `press` (ms since the latest press, from replay time). It is off when Click feedback is off, and under the viewer's reduced motion. The export page adds the press age to its dirty-frame key, so ripple and pulse frames are captured.

Plugins and deployments add themes with `api.registerSlotItem('cursor.themes', { id: 'plugin:<owner>:<id>', order, render: () => definition })`, and can reorder or hide built-ins with `configureSlot`. A definition is plain data:

- `{ kind: 'shapes', label, description?, feedback?, viewBox, size, hotspot, shapes: [{ d, fill?, stroke?, strokeWidth?, tint? }] }`: up to 16 SVG paths, set as attributes and never parsed as markup.
- `{ kind: 'cua-lottie', label, description?, src, player }`: a CUA `.lottie` theme at an https or same-origin `src`. On first draw, the archive is fetched and validated (`readCuaTheme`: a bounded ZIP reader, the v2 manifest, `manifest.json` listing every animation, frame limits), and `player()` is called to lazy-load a `CuaLottiePlayer` adapter (`draw(canvas, archive, animation, frame)`). Nothing loads while the theme is unselected; the picker shows a placeholder. Replays draws `idle`'s `still_frame` at rest and the `click` animation frame for the press age (`ip + floor(age × 30 / 1000)`), so seeks and video frames are exact. The export page awaits the frame before capture. If the archive or player fails, the theme draws the default arrow.

A saved theme that isn't available here (its plugin is not loaded) draws the default arrow, and the picker notes it. The export page loads the page's plugin client entries before mounting the cursor. Today the server lists none on the render page, so plugin themes export as the arrow until it does.

## Motion styles

The inspector's **Motion** radio group picks how the cursor travels between recorded targets. The arrow, size, idle hiding and click feedback are unchanged by it. Each row draws the style's real trajectory for one canonical move (planned once by the same planner), and a dot runs along it once when the row is chosen or hovered with a mouse; never on mount and never under reduced motion.

| Style | Path | Speed and settle | Duration (Cua `native` timing) |
| --- | --- | --- | --- |
| `signature_arc` (default) | Cua bezier, arc 0.16, flow 0.15 | minimum jerk, 1.8 % follow-through (max 8 pt) peaking at 82 % | Fitts × 1.1 |
| `spring_settle` | Cua bezier, arc 0.12 | minimum jerk to 68 %, then a damped wobble (5 %, max 6 pt, 1.3 cycles) | Fitts × 1.35 |
| `magnetic` | bow 0.04 | simulated: cruise up to 1500 pt/s, slow to the 40 pt snap radius, then pulled in | simulated, ≤ 4 s |
| `comet_swoop` | Cua bezier, arc 0.24, flow 0.2 | in-out cubic | Fitts × 1.15 |
| `adaptive` | ≤ 900 pt: bow 0.02; longer: arc 0.25–0.35 (seeded), flow 0.2 | minimum jerk; in-out cubic | `50 + 150 log2(D/24 + 1)` ms, 180–1400; `350 + 0.35 D` ms, 450–1100 |
| `classic` | Dubins glide of the arrow's body, turn radius 80 pt | 300 → 900 → 200 pt/s, then an arrival spring (k 400, damping 17) | simulated |

Fitts is `150 + 120 log2(D / 24 + 1)` ms clamped to 300–1000. Replays never knows the target rect, so every move uses CUA's default 24 pt target, and `adaptive`'s `precise_click` branch (targets under 16 pt) does not apply. The arrow stays upright for every style; only the hotspot follows the trajectory. CUA's glow, trail, magnet, ripple and canvas player are not imported.

Determinism: `adaptive`'s random arc is drawn from a mulberry32 stream seeded with the move's identity (`index:x,y` of its target), never the clock, so viewer and export draw the same path. Every move still arrives at its recorded target at its timestamp, is compressed when the recording allows less time, and hands off from the previous move's pose when they overlap. The viewer's reduced-motion preference replaces every style with the same short straight glide; export never reads it.

## Saved settings and rendering

`ReplayEdits.cursor` has optional `visible`, `size`, `hideWhenIdle`, `clickFeedback`, `motionStyle`, `appearance` and `color` fields. Defaults are true, 1, true, true, `signature_arc`, `core:arrow` and the theme's own colours respectively. Size is a 0.5–2 multiplier of the existing 32 px cursor canvas. Idle hiding keeps the existing 1.5-second delay and fade. Click feedback uses the existing deterministic squish, suppressed under reduced motion.

The shared validator (`assertReplayCursor` in `src/shared/cursor.ts`, called by `assertReplayEdits`) and the JSON schema validate settings. `motionStyle` must be one of the six identifiers. `appearance` must be a `core:*` built-in or a `plugin:<owner>:<id>` slot item id. `color` must be one of the six swatch names. Normalization removes default values and empty cursor objects, preserving existing edit hashes. Non-default settings count as edits and participate in the MP4 cache version. `playbackEffects` transports settings through both original-timeline editor preview and edited-timeline viewer/export. `ReplayController` applies them on mount and when effects change; the export frame planner uses the same configured cursor track. Reset restores the previous rendering behavior.

The size slider commits once when a drag or keyboard adjustment completes. Its percentage readout tracks the drag; playback updates on commit. No rrweb event or captured content is rewritten, and cursor controls do not alter blur settings.

## Validation

Integration validation runs in its own Boat session, independently of the live preview box. The reproducible scripts and logs are in `.review-artifacts/ui-integration/`: `check.sh` runs the focused unit/API suite, typecheck, scoped lint and production build; `browser.sh` runs caption, brand, cursor and export-page checks with one worker, a maximum 1280 × 800 viewport, device scale factor 1 and WebGL disabled. Run these commands through the caller's own Boat session:

```sh
pnpm exec vp fmt --config .oxfmtrc.json --write src/shared/cursor.ts src/shared/edits.ts src/shared/effects.ts src/client/cursor-motion.ts src/client/replay-cursor.ts src/client/player.ts src/client/render/main.ts src/client/editor/CursorInspector.tsx src/client/editor/Editor.tsx docs/formats/edits.schema.json test/cursor-settings.test.ts
pnpm exec vp test run --config vitest.config.ts test/cursor-settings.test.ts test/cursor-motion.test.ts test/cursor-motion-styles.test.ts test/edits.test.ts test/effects.test.ts test/editor-state.test.ts test/render-frames.test.ts test/edits-api.test.ts
pnpm typecheck
```

The automated `e2e/cursor-controls.spec.ts` covers desktop and 390 px geometry, keyboard entry and dismissal, switches, size adjustment, motion-style arrow-key selection, undo/redo, autosave/reload, reset, viewer rendering and preservation of existing blur edits. `e2e/cursor-export.spec.ts` loads the production export entry, checks saved size/visibility and blur rendering, encodes individual rendered frames to MP4 and probes their format. It does not exercise a complete queued video export.

For broader manual coverage, verify the editor at desktop and narrow widths: open/close the inspector; use Tab, Space, arrows and Escape; toggle visibility, idle fading and click feedback; change size; undo/redo; reload after autosave; compare viewer and an exported MP4 with the same saved edits. Check that existing blur edits remain in the exported video. Reduced motion should continue suppressing the press animation.
