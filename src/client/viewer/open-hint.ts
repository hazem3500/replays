import { parseRoute } from '../route.ts';
import { readSessionStorage, readStorage } from '../storage.ts';
import { defaultInspectorHeight, maxInspectorHeight, MIN_INSPECTOR_HEIGHT } from './inspector-size.ts';

/* why: the loading shell draws the replay page at its stored size, with the card's picture, before the bundle or the
 * viewer's code arrive; it lives outside the viewer chunk, so the few viewer storage keys it reads are repeated here
 * (StepRail.tsx, Inspector.tsx, Viewer.tsx: keep in sync).
 */
const STEPS_WIDTH_KEY = 'replays-steps-width';
const INSPECTOR_HEIGHT_KEY = 'replays-inspector-height';
const INSPECTOR_COLLAPSED_KEY = 'replays-inspector-collapsed';
const RAIL_COLLAPSED_KEY = 'replays-steps-collapsed';

/**
 * What the page opening the replay already knows (the index writes it before navigating; see OPEN_HINT_KEY):
 * the title, the recording's viewport and step count.
 */
export const OPEN_HINT_KEY = 'replays-open-hint';
export interface OpenHint {
  id: string;
  title?: string;
  viewport?: { width: number; height: number };
  steps?: number;
  /** A source chip (a linked pull request or ticket) shows beside the title. */
  source?: boolean;
  /** The card's poster, or its opening still when loaded: the frame shows it while loading (navigation.ts). */
  poster?: string;
  /** `poster` is the opening still (the replay's first paint), not the list poster. */
  still?: boolean;
}

const isOpenHint = (value: unknown): value is OpenHint =>
  typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string';

/** The id the open hint must name for this page: the replay's, or the suite's on a suite page. */
function routeId() {
  const route = parseRoute(location.pathname, location.search);
  return route.kind === 'suite' || route.kind === 'replay' || route.kind === 'edit' ? route.id : undefined;
}

/** The hint the index left for this page, if it is for this page. */
export function readOpenHint(): OpenHint | undefined {
  const raw = readSessionStorage(OPEN_HINT_KEY);
  if (!raw) return;
  let hint: unknown;
  try {
    hint = JSON.parse(raw);
  } catch {
    return;
  }
  return isOpenHint(hint) && hint.id === routeId() ? hint : undefined;
}

export function readViewerLoadingLayout(hint: OpenHint | undefined) {
  const savedHeight = Number(readStorage(INSPECTOR_HEIGHT_KEY));
  const height =
    Number.isFinite(savedHeight) && savedHeight > 0
      ? Math.round(Math.min(Math.max(savedHeight, MIN_INSPECTOR_HEIGHT), maxInspectorHeight()))
      : defaultInspectorHeight();
  const savedCollapsed = readStorage(INSPECTOR_COLLAPSED_KEY);
  const collapsed = savedCollapsed === '1';
  const stepsWidth = Number(readStorage(STEPS_WIDTH_KEY));
  const ratio = hint?.viewport && hint.viewport.height > 0 ? hint.viewport.width / hint.viewport.height : 16 / 10;
  const railCollapsed = readStorage(RAIL_COLLAPSED_KEY) === '1';
  return { height, collapsed, railCollapsed, stepsWidth: Number.isFinite(stepsWidth) && stepsWidth > 0 ? stepsWidth : undefined, ratio };
}
