# Editor cursor controls

The editor's **Cursor** toolbar button opens a small side inspector; closing it gives the preview its space back. On narrow screens it floats over the preview. Settings apply to the whole replay, use the existing undo and autosave flow, and reset to the previous cursor behavior.

## Research and scope

- [Screen Studio's cursor guide](https://screen.studio/guide/cursor) groups visibility, size and idle hiding together, with additional behavior behind an advanced disclosure. The inspector adopts that focused grouping and opens only when requested.
- [Recordly.dev](https://recordly.dev/) links to [webadderallorg/Recordly](https://github.com/webadderallorg/Recordly), the relevant open-source desktop recorder. Its cursor controls include overlay visibility, size, smoothing and click bounce. The inspector exposes the existing CUA press animation as click feedback.

There is **no installed CUA dependency or cursor asset pack** in package.json or the lockfile. `src/client/cursor-motion.ts`, `cursor-styles.ts`, `cursor-path.ts` and `cursor-dubins.ts` are a local MIT-licensed port, attributed to `@trycua/cursor-motion` at CUA revision `f982ea0`. The port plans the hotspot for each of the library's six built-in motion styles (`MOTION_STYLES` in `src/style.ts`): `signature_arc`, `spring_settle`, `magnetic`, `comet_swoop`, `adaptive` and `classic`. It draws one arrow path from CUA Driver's `cursor-overlay/assets/build_default_theme.py`, on a 128-unit canvas with hotspot (55, 30). That arrow is the entire glyph inventory; no additional themes, OS cursors or glyph presets are asserted or offered.

The cursor's look is a separate choice, `cursor.appearance` (`src/client/cursor-themes.ts`): the CUA arrow (default), a classic pointer, a hand, a dot, a ring and an agent pointer with a name tag, each optionally tinted by `cursor.color`. These are the built-in shapes from the unshipped cursor-appearance increment. Its plugin slot and the dotLottie loader for CUA theme archives are not ported: CUA itself ships one theme, whose arrow is the default here, and loading third-party archives needs its own review. Every glyph is inline-painted SVG, so the render page draws it without the app stylesheet. A theme's click ripple or pulse draws only while a press is under way, from the pose's press age, so seeking and export frames are exact.

The arrow stays upright in every style, and Cua's glow, trail, magnet and ripple effects are not drawn. Replays never knows the target element, so every move aims at Cua's default 24 pt target. As a result `adaptive` only chooses between its near-straight reach and its long-move swoop, never its small-target generator. Its swoop is seeded from the move's coordinates, so a replay always plans the same path.

The inspector's **Motion** picker is a radio group of the six styles. Each card draws the path its style plans for the same sample move, using the same planner as playback. The selected, hovered or focused card plays the move as an SVG `animateMotion`; under reduced motion every card shows the still path and the arrow at rest. Sounds, looping, motion blur and custom motion specs are outside this change.

## Saved settings and rendering

`ReplayEdits.cursor` has optional `visible`, `size`, `hideWhenIdle`, `clickFeedback` and `motion` fields. Defaults are true, 1, true, true and `signature_arc` respectively. Size is a 0.5 to 2 multiplier of the existing 32 px cursor canvas. Idle hiding keeps the existing 1.5-second delay and fade. Click feedback uses the existing deterministic squish, suppressed under reduced motion.

The shared edit validator and JSON schema validate settings. Normalization removes default values and empty cursor objects, preserving existing edit hashes. Non-default settings count as edits and participate in the MP4 cache version. `playbackEffects` transports settings through both original-timeline editor preview and edited-timeline viewer/export. `ReplayController` applies them on mount and when effects change; the export frame planner uses the same configured cursor track. Reset restores the previous rendering behavior.

The size slider commits once when a drag or keyboard adjustment completes. Its percentage readout tracks the drag; playback updates on commit. No rrweb event or captured content is rewritten, and cursor controls do not alter blur settings.

## Validation

Integration validation runs in its own Boat session, independently of the live preview box. The reproducible scripts and logs are in `.review-artifacts/ui-integration/`: `check.sh` runs the focused unit/API suite, typecheck, scoped lint and production build; `browser.sh` runs caption, brand, cursor and export-page checks with one worker, a maximum 1280 × 800 viewport, device scale factor 1 and WebGL disabled. Run these commands through the caller's own Boat session:

```sh
pnpm exec vp fmt --config .oxfmtrc.json --write src/shared/cursor.ts src/shared/edits.ts src/shared/effects.ts src/client/cursor-motion.ts src/client/replay-cursor.ts src/client/player.ts src/client/render/main.ts src/client/editor/CursorInspector.tsx src/client/editor/Editor.tsx docs/formats/edits.schema.json test/cursor-settings.test.ts
pnpm exec vp test run --config vitest.config.ts test/cursor-settings.test.ts test/cursor-motion.test.ts test/edits.test.ts test/effects.test.ts test/editor-state.test.ts test/render-frames.test.ts test/edits-api.test.ts
pnpm typecheck
```

The automated `e2e/cursor-controls.spec.ts` covers desktop and 390 px geometry, keyboard entry and dismissal, switches, size adjustment, undo/redo, autosave/reload, reset, viewer rendering and preservation of existing blur edits. `e2e/cursor-export.spec.ts` loads the production export entry, checks saved size/visibility and blur rendering, encodes individual rendered frames to MP4 and probes their format. It does not exercise a complete queued video export.

For broader manual coverage, verify the editor at desktop and narrow widths: open/close the inspector; use Tab, Space, arrows and Escape; toggle visibility, idle fading and click feedback; change size; undo/redo; reload after autosave; compare viewer and an exported MP4 with the same saved edits. Check that existing blur edits remain in the exported video. Reduced motion should continue suppressing the press animation.
