/**
 * The options step's styles, added to the default UI's shadow root only when the step opens. The pill reuses the
 * recording pill's geometry: Record takes the Stop control's red tint, the options button is a quiet round control,
 * and the menu floats above the pill (a full-width sheet on phones).
 */
export const OPTIONS_STYLES = `
.pill[data-phase=options] { padding-inline-start: 3px; }
.pill .record-button { gap: 8px; padding-inline: 12px 14px; background: color-mix(in srgb, var(--r-danger) 14%, transparent); color: var(--r-danger); }
.pill .record-button.record-button:hover { background: color-mix(in srgb, var(--r-danger) 22%, transparent); color: var(--r-danger); }
.pill .record-button.record-button:active { background: color-mix(in srgb, var(--r-danger) 30%, transparent); }
.pill .record-button:focus-visible { outline-color: var(--r-danger); }
.record-icon { display: block; flex: 0 0 8px; width: 8px; height: 8px; border-radius: 50%; background: currentColor; transition: transform 160ms var(--r-ease); }
.pill[data-phase=options] .surface-controls { padding-inline-start: 2px; }
.gesture-icon [data-icon-part], .gesture-icon [data-icon-group] { transform-box: fill-box; }
.options-button { position: relative; }
.options-button[data-changed]::after { content: ''; position: absolute; inset-block-start: 4px; inset-inline-end: 4px; width: 6px; height: 6px; border-radius: 50%; background: var(--r-primary); box-shadow: 0 0 0 2px var(--r-bg); }
.pill .options-button[aria-expanded=true] { background: var(--r-hover); color: var(--r-fg); }
.options-menu { position: fixed; inset-inline-start: 50%; inset-block-end: calc(16px + var(--pill-h) + 8px); transform: translateX(-50%); inline-size: 280px; max-inline-size: calc(100vw - 24px); max-block-size: min(560px, calc(100dvh - var(--pill-h) - 40px)); overflow: auto; overscroll-behavior: contain; padding: 4px; border: 1px solid var(--r-border); border-radius: calc(var(--r-radius) + 6px); background: var(--r-bg); color: var(--r-fg); font-size: 13px; font-weight: 500; line-height: 20px; -webkit-font-smoothing: antialiased; box-shadow: 0 1px 2px rgb(0 0 0 / .08), 0 12px 32px -12px rgb(0 0 0 / .4); }
.options-menu[hidden] { display: none; }
.options-group + .options-group { margin-block-start: 4px; padding-block-start: 4px; border-block-start: 1px solid var(--r-border); }
.options-heading { padding: 4px 8px 2px; color: var(--r-secondary); font-size: 12px; line-height: 16px; }
.options-item { position: relative; display: flex; min-block-size: 32px; padding: 5px 8px 5px 30px; border-radius: var(--r-radius); cursor: pointer; outline: none; }
.options-item:not([aria-disabled=true]):is(:hover, :focus) { background: var(--r-hover); }
.options-item:focus-visible { box-shadow: inset 0 0 0 2px var(--r-primary); }
.options-item[aria-disabled=true] { color: var(--r-secondary); cursor: default; }
.options-text { display: grid; min-inline-size: 0; }
.options-detail { color: var(--r-secondary); font-size: 12px; font-weight: 400; line-height: 16px; }
.options-check { position: absolute; inset-inline-start: 9px; inset-block-start: 8px; width: 14px; height: 14px; color: var(--r-primary); opacity: 0; transition: opacity 120ms var(--r-ease), transform 160ms var(--r-ease); }
.options-item[aria-checked=true] .options-check { opacity: 1; }
@media (max-width: 480px) { .options-menu { inset-inline: 12px; transform: none; inline-size: auto; max-inline-size: none; } }
@media (pointer: coarse) { .options-item { min-block-size: 44px; align-items: center; } .options-check { inset-block-start: calc(50% - 7px); } }
@media (prefers-reduced-motion: no-preference) {
  .record-button:is(:hover, :focus-visible) .record-icon { transform: scale(1.25); }
  .options-item:not([aria-checked=true]) .options-check { transform: scale(.6); }
}
@media (forced-colors: active) { .record-icon, .options-button[data-changed]::after { background: CanvasText; } }
`;
