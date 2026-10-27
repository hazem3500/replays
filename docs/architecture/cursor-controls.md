# Editor cursor controls

The editor's **Cursor** toolbar button opens a small side inspector; closing it gives the preview its space back. On narrow screens it floats over the preview. Settings apply to the whole replay, use the existing undo and autosave flow, and reset to the previous cursor behavior.

## Research and scope

- [Screen Studio's cursor guide](https://screen.studio/guide/cursor) groups visibility, size and idle hiding together, with additional behavior behind an advanced disclosure. The inspector adopts that focused grouping and opens only when requested.
- [Recordly.dev](https://recordly.dev/) links to [webadderallorg/Recordly](https://github.com/webadderallorg/Recordly), the relevant open-source desktop recorder. Its cursor controls include overlay visibility, size, smoothing and click bounce. The inspector exposes the existing CUA press animation as click feedback.

There is **no installed CUA dependency or cursor asset pack** in package.json or the lockfile. `src/client/cursor-motion.ts` is a local MIT-licensed port, attributed to `@trycua/cursor-motion` at CUA revision `f982ea0`. It implements the `signature_arc` motion style and one arrow path from CUA Driver's `cursor-overlay/assets/build_default_theme.py`, on a 128-unit canvas with hotspot (55, 30). That arrow is the entire current glyph inventory. Upstream asset lookup could not be completed during implementation; no additional themes, OS cursors or presets are asserted or offered.

The style preview therefore identifies the real **CUA arrow** rather than presenting a one-option picker. A multi-asset picker remains a separate decision: choose and verify an upstream asset inventory, licenses and hotspots, then bundle it and implement each selection in the common renderer. This slice adds no dependency. Ripple effects, sounds, looping, motion blur and additional motion presets are outside this change.

## Saved settings and rendering

`ReplayEdits.cursor` has optional `visible`, `size`, `hideWhenIdle` and `clickFeedback` fields. Defaults are true, 1, true and true respectively. Size is a 0.5–2 multiplier of the existing 32 px cursor canvas. Idle hiding keeps the existing 1.5-second delay and fade. Click feedback uses the existing deterministic squish, suppressed under reduced motion.

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
