/**
 * The default UI's shadow-root stylesheet; omitted theme values inherit the host's Replays tokens.
 * Type: 13/20 at weight 500 on the floating pill (labels, figures and actions alike), dialogs 15/22 titles over 13/20 copy.
 * Geometry: a 40 px pill (56 px on touch); every control sits one 6 px inset from its edge, so a 28 px (44 px) control's
 * radius is the pill's radius minus that inset and the end caps stay concentric.
 */
export const DEFAULT_UI_STYLES = `
:host { all: initial; --r-bg: var(--recorder-background, var(--surface-raised, var(--background, #1a1e26))); --r-fg: var(--recorder-foreground, var(--text, var(--foreground, #eef0f5))); --r-secondary: var(--recorder-secondary, var(--text-secondary, #b2b8c5)); --r-border: var(--recorder-border, var(--line, var(--border, #262b35))); --r-strong: var(--recorder-borderStrong, var(--line-strong, #3a4150)); --r-hover: var(--recorder-hover, var(--surface-hover, #232832)); --r-pressed: var(--recorder-pressed, var(--surface-pressed, #2c323d)); --r-primary: var(--recorder-primary, var(--accent, var(--primary, #8b9dff))); --r-primary-fg: var(--recorder-primaryForeground, #10131b); --r-danger: var(--recorder-danger, var(--danger, #f04438)); --r-radius: var(--recorder-radius, var(--radius, 6px)); --r-ease: cubic-bezier(.23, 1, .32, 1); --pill-h: 40px; --pill-inset: 6px; --pill-ctl: calc(var(--pill-h) - 2 * var(--pill-inset)); }
* { box-sizing: border-box; font-family: var(--recorder-font, var(--sans, Inter, ui-sans-serif, system-ui, sans-serif)); }
.backdrop { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgb(0 0 0 / .36); }
.dialog, .pill { background: var(--r-bg); color: var(--r-fg); border: 1px solid var(--r-border); font-size: 13px; font-weight: 500; line-height: 20px; -webkit-font-smoothing: antialiased; font-feature-settings: "cv05", "cv08"; }
.dialog { width: min(400px, 100%); max-block-size: calc(100dvh - 32px); overflow: auto; overscroll-behavior: contain; padding: 20px; border-radius: calc(var(--r-radius) + 6px); box-shadow: 0 1px 2px rgb(0 0 0 / .08), 0 24px 48px -12px rgb(0 0 0 / .32); }
h2 { margin: 0 0 6px; font-size: 15px; font-weight: 600; line-height: 22px; letter-spacing: -.01em; text-wrap: balance; }
p { margin: 0; color: var(--r-secondary); font-weight: 400; text-wrap: pretty; }
.notice { display: flex; gap: 8px; margin-top: 12px; padding: 8px 10px; border-radius: var(--r-radius); background: var(--r-hover); font-size: 12px; line-height: 18px; }
.notice .icon { flex: 0 0 auto; width: 14px; height: 14px; margin-block-start: 2px; color: var(--r-secondary); }
label { display: block; margin: 16px 0 6px; color: var(--r-fg); font-size: 12px; line-height: 16px; }
textarea { display: block; width: 100%; min-height: 84px; resize: vertical; padding: 8px 10px; border: 1px solid var(--r-strong); border-radius: var(--r-radius); background: transparent; color: var(--r-fg); font: inherit; font-weight: 400; outline: none; transition: border-color 120ms var(--r-ease), box-shadow 120ms var(--r-ease); }
textarea:focus-visible { border-color: var(--r-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--r-primary) 24%, transparent); }
.actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
button, a { font: inherit; -webkit-tap-highlight-color: transparent; }
button { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; min-height: 32px; padding: 0 12px; border: 1px solid var(--r-strong); border-radius: var(--r-radius); background: var(--r-bg); color: var(--r-fg); font-weight: 500; white-space: nowrap; cursor: pointer; transition: background-color 120ms var(--r-ease), color 120ms var(--r-ease), scale 120ms var(--r-ease); }
button:hover { background: var(--r-hover); }
button:active { background: var(--r-pressed); }
button.primary, a.primary { border-color: transparent; background: var(--r-primary); color: var(--r-primary-fg); }
button.primary:hover, a.primary:hover { background: color-mix(in srgb, var(--r-primary) 88%, var(--r-fg)); }
button.primary:active, a.primary:active { background: color-mix(in srgb, var(--r-primary) 80%, var(--r-fg)); }
:is(button, a):focus-visible { outline: 2px solid var(--r-primary); outline-offset: 2px; }
.pill:focus-visible { outline: 2px solid var(--r-primary); outline-offset: 2px; }
.pill { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; align-items: center; inline-size: max-content; max-inline-size: calc(100vw - 24px); min-block-size: var(--pill-h); padding: calc(var(--pill-inset) - 1px) calc(var(--pill-inset) - 1px) calc(var(--pill-inset) - 1px) 13px; border-radius: calc(var(--pill-h) / 2); box-shadow: inset 0 1px 0 rgb(255 255 255 / .04), 0 2px 6px -2px rgb(0 0 0 / .12), 0 12px 32px -12px rgb(0 0 0 / .4); outline: none; }
.pill[hidden] { display: none; }
.pill[data-phase=uploading] { padding-inline-end: 15px; }
.pill[data-custom=true] { inline-size: min(440px, calc(100vw - 24px)); padding-block: 8px; border-radius: max(12px, calc(var(--r-radius) + 6px)); }
.surface-content { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.surface-content > .message { flex: 0 1 auto; min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.surface-controls { display: flex; align-items: center; justify-content: flex-end; flex-shrink: 0; gap: 4px; margin-inline-start: auto; }
.pill:is([data-phase=complete], [data-phase=error], [data-custom=true]) .surface-content { flex-wrap: wrap; row-gap: var(--pill-inset); }
.pill:is([data-phase=complete], [data-phase=error], [data-custom=true]) .surface-controls { flex-wrap: wrap; flex-shrink: 1; min-inline-size: 0; max-inline-size: 100%; }
.pill:is([data-phase=complete], [data-phase=error], [data-custom=true]) .message { white-space: normal; overflow-wrap: anywhere; padding-block: 4px; }
.surface-controls > :is(button, a) { max-inline-size: 100%; }
.status-icon { flex: 0 0 auto; width: 16px; height: 16px; margin-inline-end: -2px; }
.pill[data-phase=complete] .status-icon { color: var(--r-primary); }
.pill[data-phase=error] .status-icon { color: var(--r-danger); }
.pill[data-phase=error][data-tone=notice] .status-icon { color: var(--r-secondary); }
.recording-label { white-space: nowrap; }
.dot { position: relative; flex: 0 0 8px; height: 8px; margin-inline-end: 2px; border-radius: 50%; background: var(--r-danger); box-shadow: 0 0 0 3px color-mix(in srgb, var(--r-danger) 22%, transparent); }
.upload-activity { position: relative; display: inline-flex; align-items: center; flex: 0 0 28px; margin-inline-start: 4px; }
.upload-activity-track { display: block; width: 28px; height: 4px; overflow: hidden; border-radius: 4px; background: color-mix(in srgb, var(--r-primary) 18%, transparent); }
.upload-activity-fill { display: block; width: 10px; height: 100%; border-radius: inherit; background: var(--r-primary); transform: translateX(9px); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.time { display: inline-block; flex: 0 0 auto; min-inline-size: 4ch; color: var(--r-secondary); font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; text-align: start; transition: color 240ms var(--r-ease); }
.pill[data-warning=final] .time { color: var(--r-danger); }
.pill button, .pill a { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-block-size: var(--pill-ctl); padding: 0 10px; border: 0; border-radius: calc(var(--pill-ctl) / 2); background: color-mix(in srgb, var(--r-fg) 7%, transparent); color: var(--r-fg); font-weight: 500; text-decoration: none; white-space: nowrap; cursor: pointer; transition: background-color 120ms var(--r-ease), color 120ms var(--r-ease), scale 120ms var(--r-ease); }
.pill :is(button, a):hover { background: color-mix(in srgb, var(--r-fg) 11%, transparent); }
.pill :is(button, a):active { background: color-mix(in srgb, var(--r-fg) 15%, transparent); }
.pill :is(a, button).primary { background: color-mix(in srgb, var(--r-primary) 16%, transparent); color: var(--r-primary); }
.pill :is(a, button).primary:hover { background: color-mix(in srgb, var(--r-primary) 22%, transparent); }
.pill :is(a, button).primary:active { background: color-mix(in srgb, var(--r-primary) 28%, transparent); }
.pill .icon-button { inline-size: var(--pill-ctl); padding: 0; background: transparent; color: var(--r-secondary); }
.pill .icon-button:hover { color: var(--r-fg); }
.icon { display: block; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: transform 160ms var(--r-ease); }
.pill a .icon { width: 14px; height: 14px; margin-inline-end: -2px; }
.pill .finish-button { margin-inline-start: 4px; background: color-mix(in srgb, var(--r-danger) 14%, transparent); color: var(--r-danger); }
.pill .finish-button.finish-button.finish-button:hover { background: color-mix(in srgb, var(--r-danger) 22%, transparent); color: var(--r-danger); }
.pill .finish-button.finish-button.finish-button:active { background: color-mix(in srgb, var(--r-danger) 30%, transparent); }
.pill :is(button, a):focus-visible { outline-offset: 1px; }
.pill .finish-button:focus-visible { outline-color: var(--r-danger); }
.stop-icon { display: block; width: 10px; height: 10px; flex-shrink: 0; border-radius: 2.5px; background: currentColor; transition: transform 160ms var(--r-ease), border-radius 160ms var(--r-ease); }
.status-spinner { display: block; box-sizing: border-box; width: 16px; height: 16px; flex-shrink: 0; border: 2px solid color-mix(in srgb, var(--r-fg) 22%, transparent); border-top-color: var(--r-primary); border-radius: 50%; }
button:disabled { opacity: .6; cursor: default; }
@media (prefers-reduced-motion: no-preference) {
  :is(button, .pill a):active:not(:disabled) { scale: .96; }
  .finish-button:is(:hover, :focus-visible) .stop-icon { transform: scale(1.12); border-radius: 3px; }
  :is(button, a):is(:hover, :focus-visible) > .icon-open { transform: translate(1px, -1px); }
  :is(button, a):is(:hover, :focus-visible) > .icon-close { transform: rotate(90deg); }
}
@media (pointer: coarse) { :host { --pill-h: 56px; } button { min-height: 44px; } }
@media (forced-colors: active) { .dot, .stop-icon { background: CanvasText; } }
`;
