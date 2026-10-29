import {
  CaptionsIcon,
  EyeOffIcon,
  FastForwardIcon,
  HourglassIcon,
  type LucideIcon,
  MapPinIcon,
  ScissorsIcon,
  ZoomInIcon,
} from 'lucide-react';

import type { EffectKind } from './state.ts';

/** The platform's modifier as key caps show it. */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = IS_MAC ? '⌘' : 'Ctrl+';

/** A tool on the bar: what it does, its visible label, its key and its icon. */
export interface EditorTool {
  id: 'cut' | 'waits' | 'highlight';
  label: string;
  /** The full action, for the tooltip and the accessible name (it contains the label). */
  action: string;
  key: string;
  icon: LucideIcon;
}

export const BAR_TOOLS: readonly EditorTool[] = [
  { id: 'cut', label: 'Cut', action: 'Cut a second at the playhead', key: 'C', icon: ScissorsIcon },
  { id: 'waits', label: 'Waits', action: 'Find waits to remove', key: 'W', icon: HourglassIcon },
  { id: 'highlight', label: 'Highlight', action: 'Highlight this moment', key: 'M', icon: MapPinIcon },
];

/** What the Add menu adds at the playhead, each with its key. */
export interface AddItem {
  kind: EffectKind;
  label: string;
  key: string;
  icon: LucideIcon;
}

export const ADD_ITEMS: readonly AddItem[] = [
  { kind: 'zoom', label: 'Zoom on clicks', key: 'Z', icon: ZoomInIcon },
  { kind: 'speed', label: 'Speed up', key: 'F', icon: FastForwardIcon },
  { kind: 'blur', label: 'Blur an area', key: 'B', icon: EyeOffIcon },
  { kind: 'caption', label: 'Captions', key: 'T', icon: CaptionsIcon },
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
    items: ADD_ITEMS.map((item) => ({ keys: [item.key], label: item.label })),
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
