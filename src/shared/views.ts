import { isProfileId } from './profiles.ts';
import { assertShape, type Check, type Checks, isBoolean, isRecord, listOf, numberIn, oneOf, wholeNumber } from './validate.ts';

/** How a page with two or more recordings arranges them; ignored with one. */
export type ViewLayout = 'single' | 'grid' | 'spotlight';
export const VIEW_LAYOUTS: readonly ViewLayout[] = ['single', 'grid', 'spotlight'];

/** The inspector's built-in tabs; plugin tabs are named `plugin:<plugin>:<id>`. */
export const VIEW_TABS = ['issues', 'console', 'network', 'performance', 'context', 'comments'] as const;

/**
 * A way to look at a replay or a set of recordings: which panels lead, where playback starts, how a set is laid out.
 * Never stored with a replay: the page picks one from `?view=`, the suite's or replay's profile, or the number of
 * recordings (docs/extension-api.md#views).
 */
export interface ViewPreset {
  /** `[a-z][a-z0-9-]{0,39}`, like profile ids. A config entry with a built-in id overrides that view's fields. */
  id: string;
  /** Switcher copy, at most 24 characters. */
  label: string;
  /** Lower first in the switcher. Default 0; ties keep built-ins, then config, then plugins. */
  order?: number;
  /** Arrangement for two or more recordings. Default `'grid'`. */
  layout?: ViewLayout;
  /** Default `'start'`. A permalink (`?t=`, `#step-…`) always wins. */
  openAt?: 'start' | 'first-error';
  /** With `openAt: 'first-error'`: how long before the error to land (ms, default 1000). */
  leadMs?: number;
  inspector?: {
    state?: 'open' | 'collapsed' | 'hidden';
    /** Tab order: built-in ids (VIEW_TABS) or plugin keys. Unlisted tabs follow in registry order; none is unreachable. */
    tabs?: readonly string[];
    /** The tab shown first; default the first of `tabs`. */
    tab?: string;
    /** With several recordings: rows of the focused one, or of all of them. */
    scope?: 'single' | 'all';
  };
  stage?: {
    captions?: boolean;
    steps?: 'open' | 'collapsed' | 'hidden';
    /** `viewer.scrubber.tracks` ids to show; default all. */
    tracks?: readonly string[];
    /** `'quiet'`: the top bar fades while playing. */
    chrome?: 'full' | 'quiet';
  };
  /** `viewer.headline` slot ids shown between the top bar and the stage. */
  headline?: readonly string[];
  /** Playback speed on open, 0.25 to 4. */
  speed?: number;
}

/** A view as `GET /api/config` and `<meta name="app-views">` list it. */
export interface ViewInfo extends ViewPreset {
  order: number;
  /** One of the views core ships. */
  builtIn?: true;
}

/** The fallback for everything: today's viewer. */
export const DEFAULT_VIEW = 'standard';
/** What a page with two or more recordings opens in when nothing else names a view. */
export const COMPARE_VIEW = 'compare';

/** The views core ships, in switcher order. */
export const BUILT_IN_VIEWS: readonly ViewPreset[] = [
  { id: 'standard', label: 'Standard', order: 0, inspector: { tabs: ['console', 'network', 'performance'] } },
  {
    id: 'compare',
    label: 'Compare',
    order: 1,
    layout: 'grid',
    inspector: { tabs: ['issues', 'performance', 'network', 'console'], scope: 'all' },
    headline: ['core:compare-summary'],
  },
  {
    id: 'performance',
    label: 'Performance',
    order: 2,
    layout: 'spotlight',
    openAt: 'start',
    inspector: { state: 'open', tabs: ['performance', 'network', 'console'] },
    stage: { tracks: ['core:performance', 'core:steps'] },
    headline: ['core:vitals'],
  },
  {
    id: 'debug',
    label: 'Debug',
    order: 3,
    openAt: 'first-error',
    leadMs: 1000,
    inspector: { state: 'open', tabs: ['issues', 'console', 'network', 'context'] },
    stage: { tracks: ['core:errors', 'core:steps'] },
    headline: ['core:issues'],
  },
  {
    id: 'walkthrough',
    label: 'Walkthrough',
    order: 4,
    inspector: { state: 'hidden' },
    stage: { captions: true, steps: 'collapsed', chrome: 'quiet', tracks: ['core:steps'] },
  },
  {
    id: 'review',
    label: 'Review',
    order: 5,
    inspector: { state: 'open', tabs: ['comments', 'context'] },
    stage: { steps: 'collapsed', tracks: ['core:comments', 'core:steps'] },
    headline: ['core:comments'],
  },
  {
    id: 'support',
    label: 'Support',
    order: 6,
    openAt: 'first-error',
    inspector: { state: 'open', tabs: ['context', 'console', 'network'] },
  },
];

const MAX_LABEL = 24;
const TAB = /^(?:[a-z][a-z0-9-]{0,39}|plugin:[a-z0-9@/._-]{1,100}:[a-z0-9._-]{1,60})$/;
const SLOT_ID = /^[a-z0-9@/._-]{1,100}:[a-z0-9._-]{1,60}$/;
const matches =
  (pattern: RegExp): Check =>
  (value) =>
    typeof value === 'string' && pattern.test(value);

const INSPECTOR_CHECKS: Checks = {
  state: [oneOf(['open', 'collapsed', 'hidden']), 'must be one of open, collapsed, hidden'],
  tabs: [listOf(matches(TAB), 20), 'must be a list of at most 20 tab ids'],
  tab: [matches(TAB), 'must be a tab id'],
  scope: [oneOf(['single', 'all']), 'must be one of single, all'],
};

const STAGE_CHECKS: Checks = {
  captions: [isBoolean, 'must be a boolean'],
  steps: [oneOf(['open', 'collapsed', 'hidden']), 'must be one of open, collapsed, hidden'],
  tracks: [listOf(matches(SLOT_ID), 20), 'must be a list of at most 20 ids'],
  chrome: [oneOf(['full', 'quiet']), 'must be one of full, quiet'],
};

const VIEW_CHECKS: Checks = {
  id: [isProfileId, 'must look like "debug" or "design-review"'],
  label: [
    (value) => typeof value === 'string' && Boolean(value.trim()) && value.length <= MAX_LABEL,
    `must be a non-empty string of at most ${MAX_LABEL} characters`,
  ],
  order: [(value) => typeof value === 'number' && Number.isFinite(value), 'must be a finite number'],
  layout: [oneOf(VIEW_LAYOUTS), `must be one of ${VIEW_LAYOUTS.join(', ')}`],
  openAt: [oneOf(['start', 'first-error']), 'must be one of start, first-error'],
  leadMs: [wholeNumber(0, 60_000), 'must be a whole number of milliseconds from 0 to 60000'],
  inspector: [isRecord, 'must be an object'],
  stage: [isRecord, 'must be an object'],
  headline: [listOf(matches(SLOT_ID), 20), 'must be a list of at most 20 ids'],
  speed: [numberIn(0.25, 4), 'must be a number from 0.25 to 4'],
};

/** Throws a readable error unless `value` is a well-formed view preset. */
export function assertViewPreset(value: unknown, where = 'view'): asserts value is ViewPreset {
  assertShape(value, VIEW_CHECKS, where);
  if (value.id === undefined) throw new Error(`${where}.id must look like "debug" or "design-review"`);
  if (value.label === undefined) throw new Error(`${where}.label must be a non-empty string of at most ${MAX_LABEL} characters`);
  if (value.inspector !== undefined) assertShape(value.inspector, INSPECTOR_CHECKS, `${where}.inspector`);
  if (value.stage !== undefined) assertShape(value.stage, STAGE_CHECKS, `${where}.stage`);
}
