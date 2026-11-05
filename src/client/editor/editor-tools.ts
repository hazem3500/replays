import type { AnimatedIconName } from '@/components/animated-icon.tsx';
import type { EffectKind } from './state.ts';
import { BAR_TOOLS } from './bar-tools.ts';

/** The platform's modifier as key caps show it. */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = IS_MAC ? '⌘' : 'Ctrl+';

/** What the Add menu adds at the playhead, each with its key. */
export interface AddItem {
  kind: EffectKind;
  /** The menu item's name, one or two words. */
  label: string;
  /** What it does in one short line: the menu's hint line for the item and the shortcut sheet row. */
  action: string;
  key: string;
  icon: AnimatedIconName;
}

export const ADD_ITEMS: readonly AddItem[] = [
  { kind: 'zoom', label: 'Zoom', action: 'Zoom in on every click', key: 'Z', icon: 'zoom-in' },
  { kind: 'speed', label: 'Speed up', action: 'Speed up from the playhead', key: 'F', icon: 'fast-forward' },
  { kind: 'blur', label: 'Blur', action: 'Blur part of the page', key: 'B', icon: 'eye-off' },
  { kind: 'caption', label: 'Captions', action: 'Write captions from the steps', key: 'T', icon: 'captions' },
];

export interface ShortcutRow {
  keys: string[];
  label: string;
}

/** Every editor key, in the groups the shortcut sheet shows; the bar and the Add menu read the same descriptors. */
export const EDITOR_SHORTCUT_GROUPS: Array<{ title: string; items: ShortcutRow[] }> = [
  {
    title: 'Playback',
    items: [
      { keys: ['Space', 'K'], label: 'Play or pause the result' },
      { keys: ['←', '→'], label: 'Step a tenth of a second' },
      { keys: ['Shift ←', 'Shift →'], label: 'Step a second' },
      { keys: ['J', 'L'], label: 'Jump 5 seconds' },
      { keys: ['[', ']'], label: 'Previous / next step' },
    ],
  },
  {
    title: 'Edit',
    items: [
      ...BAR_TOOLS.map((tool) => ({ keys: [tool.key], label: tool.action })),
      { keys: ['I', 'O'], label: 'Trim start / end to the playhead' },
      { keys: ['Enter'], label: 'Apply waits found, or cut the selection' },
      { keys: ['Delete'], label: 'Remove the selection' },
      { keys: ['Esc'], label: 'Deselect' },
    ],
  },
  {
    title: 'Add',
    items: ADD_ITEMS.map((item) => ({ keys: [item.key], label: item.action })),
  },
  {
    title: 'History',
    items: [
      { keys: [`${MOD}Z`], label: 'Undo' },
      { keys: [IS_MAC ? '⇧⌘Z' : 'Ctrl+Y'], label: 'Redo' },
      { keys: [`${MOD}S`], label: 'Save now' },
      { keys: ['?'], label: 'Show shortcuts' },
    ],
  },
];
