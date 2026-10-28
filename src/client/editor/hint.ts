import { formatClock } from '../../shared/replay.ts';
import type { Selection } from './state.ts';

const SELECTION_HINTS: Record<string, string> = {
  cut: 'Drag the cut’s edges to adjust it · ⌫ removes it · Esc deselects',
  highlight: 'Edit the label or timing in the panel · ⌫ removes this highlight',
  zoom: 'Drag the zoom to move it, its edges to resize · it follows the clicks inside it · ⌫ removes it',
  speed: 'This stretch plays faster in the viewer and the video · ⌫ removes it',
  blur: 'Drag the box on the preview to cover what to hide, its corners to resize · ⌫ removes it',
  caption: 'Type the caption in the panel · drag its edges on the lane to time it · ⌫ removes it',
  trim: 'Drag the clip’s edges to trim · ⌫ restores the whole replay',
};

/** The quiet one-line instruction under the editor for whatever is selected. */
export function editorHint(selection: Selection, suggesting: boolean, empty: boolean) {
  if (suggesting) return null;
  if (selection?.kind === 'range') return `${formatClock(selection.to - selection.from)} selected · C cuts it · Esc clears`;
  const forSelection = selection ? SELECTION_HINTS[selection.kind] : undefined;
  if (forSelection) return forSelection;
  return empty
    ? 'Drag the clip’s edges to trim · drag across the clip to select a cut · W finds waits'
    : 'Space plays the result · cuts are skipped';
}
