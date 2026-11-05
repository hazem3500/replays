import type { AnimatedIconName } from '@/components/animated-icon.tsx';

/** A tool on the bar: what it does, its visible label, its key and its icon. */
export interface EditorTool {
  id: 'cut' | 'waits' | 'highlight';
  label: string;
  /** The full action in one short line, for the tooltip and the accessible name (it contains the label). */
  action: string;
  key: string;
  icon: AnimatedIconName;
}

export const BAR_TOOLS: readonly EditorTool[] = [
  { id: 'cut', label: 'Cut', action: 'Cut a second at the playhead', key: 'C', icon: 'scissors' },
  { id: 'waits', label: 'Waits', action: 'Find waits to remove', key: 'W', icon: 'hourglass' },
  { id: 'highlight', label: 'Highlight', action: 'Highlight the selection, or this moment', key: 'M', icon: 'map-pin' },
];
