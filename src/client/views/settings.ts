import { readStorage, removeStorage, writeStorage } from '../storage.ts';

/** `DEFAULT_VIEW` (src/shared/views.ts) without that module, for code on the first page load (the skeleton). */
export const STANDARD_VIEW = 'standard';

/** What the viewer remembers per view, per browser. */
export type ViewSetting = 'dock-height' | 'dock-collapsed' | 'rail-collapsed' | 'tab' | 'captions';
const SETTINGS: readonly ViewSetting[] = ['dock-height', 'dock-collapsed', 'rail-collapsed', 'tab', 'captions'];

/** The storage key of one view's setting: `replays-view:debug:tab`. */
export function viewSettingKey(view: string, setting: ViewSetting) {
  return `replays-view:${view}:${setting}`;
}

export function readViewSetting(view: string, setting: ViewSetting) {
  return readStorage(viewSettingKey(view, setting)) ?? undefined;
}

export function writeViewSetting(view: string, setting: ViewSetting, value: string) {
  writeStorage(viewSettingKey(view, setting), value);
}

/** `'1'` / `'0'` as a boolean; undefined when the person never set it. */
export function readViewFlag(view: string, setting: ViewSetting) {
  const saved = readViewSetting(view, setting);
  if (saved !== '1' && saved !== '0') return;
  return saved === '1';
}

export function writeViewFlag(view: string, setting: ViewSetting, value: boolean) {
  writeViewSetting(view, setting, value ? '1' : '0');
}

/** "Reset this view": forget everything remembered for it, so it opens as its preset says. */
export function resetViewSettings(view: string) {
  for (const setting of SETTINGS) removeStorage(viewSettingKey(view, setting));
}
