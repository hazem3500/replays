/** The default UI's shadow-root stylesheet; omitted theme values inherit the host's Replays tokens. */
export const DEFAULT_UI_STYLES = `
:host { all: initial; --r-bg: var(--recorder-background, var(--surface-raised, var(--background, #1a1e26))); --r-fg: var(--recorder-foreground, var(--text, var(--foreground, #eef0f5))); --r-secondary: var(--recorder-secondary, var(--text-secondary, #b2b8c5)); --r-border: var(--recorder-border, var(--line, var(--border, #262b35))); --r-strong: var(--recorder-borderStrong, var(--line-strong, #3a4150)); --r-hover: var(--recorder-hover, var(--surface-hover, #232832)); --r-pressed: var(--recorder-pressed, var(--surface-pressed, #2c323d)); --r-primary: var(--recorder-primary, var(--accent, var(--primary, #8b9dff))); --r-primary-fg: var(--recorder-primaryForeground, #10131b); }
* { box-sizing: border-box; font-family: var(--recorder-font, var(--sans, Inter, ui-sans-serif, system-ui, sans-serif)); }
.backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / .4); display: flex; align-items: center; justify-content: center; padding: 16px; }
.dialog, .pill { background: var(--r-bg); color: var(--r-fg); border: 1px solid var(--r-border); box-shadow: 0 4px 16px rgb(0 0 0 / .12); font-size: 13px; font-weight: 500; line-height: 20px; }
.dialog { width: min(420px, 100%); border-radius: var(--recorder-radius, var(--radius, 6px)); padding: 24px; }
h2 { margin: 0 0 8px; font-size: 16px; font-weight: 600; line-height: 24px; }
p { margin: 0 0 8px; color: var(--r-secondary); }
label { display: block; margin: 16px 0 4px; color: var(--r-secondary); }
textarea { width: 100%; min-height: 80px; resize: vertical; font: inherit; padding: 8px; background: var(--r-bg); color: var(--r-fg); border: 1px solid var(--r-strong); border-radius: var(--recorder-radius, var(--radius, 6px)); }
.actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 24px; }
button, a { font: inherit; }
button { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; min-height: 32px; font-weight: 600; white-space: nowrap; padding: 5px 12px; border-radius: var(--recorder-radius, var(--radius, 6px)); border: 1px solid var(--r-strong); background: var(--r-bg); color: var(--r-fg); cursor: pointer; }
button:hover { background: var(--r-hover); }
button:active { background: var(--r-pressed); }
button.primary { background: var(--r-primary); border-color: transparent; color: var(--r-primary-fg); }
button:focus-visible, textarea:focus-visible, a:focus-visible { outline: 2px solid var(--r-primary); outline-offset: 2px; }
.pill { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; inline-size: max-content; max-inline-size: calc(100vw - 32px); min-block-size: 44px; padding: 4px 6px 4px 12px; border-radius: 16px; font-weight: 400; box-shadow: 0 2px 8px rgb(0 0 0 / .08); }
.pill[hidden] { display: none; }
.pill[data-custom=true] { inline-size: min(440px, calc(100vw - 32px)); border-radius: var(--recorder-radius, var(--radius, 6px)); }
.surface-content { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.surface-content > .message { flex: 0 1 auto; min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.surface-controls { display: flex; align-items: center; flex-shrink: 0; gap: 4px; margin-inline-start: 4px; }
.pill:is([data-phase=complete], [data-phase=error], [data-custom=true]) .surface-content { flex-wrap: wrap; }
.pill:is([data-phase=complete], [data-phase=error], [data-custom=true]) .surface-controls { flex-wrap: wrap; flex-shrink: 1; min-inline-size: 0; max-inline-size: 100%; }
.pill:is([data-phase=complete], [data-phase=error], [data-custom=true]) .message { white-space: normal; overflow-wrap: anywhere; }
.surface-controls > :is(button, a) { max-inline-size: 100%; white-space: normal; overflow-wrap: anywhere; }
.recording-label { white-space: nowrap; }
.dot { flex: 0 0 6px; height: 6px; border-radius: 50%; background: var(--recorder-danger, #e06c75); }
.pill[data-phase=uploading] { padding-inline: 14px; }
.upload-activity { position: relative; display: inline-flex; align-items: center; flex: 0 0 28px; }
.upload-activity-track { display: block; width: 28px; height: 4px; overflow: hidden; border-radius: 4px; background: color-mix(in srgb, var(--r-primary) 18%, transparent); }
.upload-activity-fill { display: block; width: 10px; height: 100%; border-radius: inherit; background: var(--r-primary); transform: translateX(9px); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.time { display: inline-block; flex: 0 0 auto; text-align: left; font-weight: 500; font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
.pill[data-phase=recording] .finish-button { margin-inline-start: -4px; }
.pill button { min-height: 32px; padding: 2px 6px; font-weight: 500; border: 0; border-radius: 12px; background: transparent; color: var(--r-secondary); }
.pill button:hover { background: var(--r-hover); color: var(--r-fg); }
.pill .icon-button { width: 32px; padding: 0; }
.close-icon::before { content: "\\00d7"; }
.pill button.primary { color: var(--r-primary); }
.stop-icon { width: 8px; height: 8px; flex-shrink: 0; border-radius: 2px; background: currentColor; }
.pill a { display: inline-flex; align-items: center; min-height: 32px; padding-inline: 6px; border-radius: 8px; color: var(--r-primary); text-decoration: none; white-space: nowrap; }
.pill a:hover { text-decoration: underline; }
@media (pointer: coarse) { button, .pill button { min-height: 44px; } .pill .icon-button { width: 44px; } }
`;
