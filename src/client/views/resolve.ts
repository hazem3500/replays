import { DEFAULT_LEAD_MS, type ProfileViewerDefaults } from '../../shared/profiles.ts';
import { COMPARE_VIEW, DEFAULT_VIEW, type ViewInfo, type ViewLayout } from '../../shared/views.ts';

/** Where the page's view came from, first match wins. */
export type ViewSource = 'url' | 'suite' | 'replay' | 'recordings';

/** A profile as far as view resolution reads it. */
export interface ViewProfile {
  view?: string | undefined;
  viewer?: ProfileViewerDefaults | undefined;
}

export interface ViewRequest {
  /** `?view=`; an unknown id falls through. */
  requested?: string | undefined;
  /** On a suite page, the suite's profile. */
  suiteProfile?: ViewProfile | undefined;
  /** The focused replay's profile (`meta.profile`, else the inferred one). */
  replayProfile?: ViewProfile | undefined;
  /** Recordings on the page; two or more open in Compare when no profile names a view. */
  recordings: number;
}

export interface ResolvedView {
  view: ViewInfo;
  source: ViewSource;
  /** The view the page means without `?view=`: a switch back to it drops the parameter. */
  fallback: ViewInfo;
  /** The profile whose `view` was taken: its legacy `viewer` defaults apply to that view only. */
  profile?: ViewProfile | undefined;
}

const STANDARD: ViewInfo = { id: DEFAULT_VIEW, label: 'Standard', order: 0 };

function fallbackView(views: readonly ViewInfo[], request: ViewRequest): Omit<ResolvedView, 'fallback'> {
  const known = (id: string | undefined) => (id ? views.find((view) => view.id === id) : undefined);
  const suite = known(request.suiteProfile?.view);
  if (suite) return { view: suite, source: 'suite', profile: request.suiteProfile };
  const replay = known(request.replayProfile?.view);
  if (replay) return { view: replay, source: 'replay', profile: request.replayProfile };
  const compare = request.recordings >= 2 ? known(COMPARE_VIEW) : undefined;
  if (compare) return { view: compare, source: 'recordings' };
  const standard = known(DEFAULT_VIEW) ?? STANDARD;
  // why: a replay or suite profile without its own view still opens with its legacy `viewer` defaults on Standard.
  const profile = request.suiteProfile?.viewer ? request.suiteProfile : request.replayProfile;
  return { view: standard, source: 'recordings', profile };
}

/**
 * The page's view: `?view=` when it names a known view, then the suite's profile, then the replay's profile, then Compare
 * for two or more recordings, else Standard.
 */
export function resolveView(views: readonly ViewInfo[], request: ViewRequest): ResolvedView {
  const fallback = fallbackView(views, request);
  const requested = request.requested ? views.find((view) => view.id === request.requested) : undefined;
  if (requested && requested.id !== fallback.view.id) return { view: requested, source: 'url', fallback: fallback.view };
  return { ...fallback, fallback: fallback.view };
}

/** What the viewer opens with in a view, before the person's remembered settings for it. */
export interface ViewDefaults {
  openAt: 'start' | 'first-error';
  leadMs: number;
  inspector: 'open' | 'collapsed' | 'hidden';
  /** Tab order: listed tabs lead, unlisted ones follow in registry order. */
  tabs: readonly string[];
  /** The tab shown first, when the person has not picked one in this view. */
  tab: string | undefined;
  captions: boolean;
  steps: 'open' | 'collapsed' | 'hidden';
  /** Built-in seek bar tracks to show; undefined shows all. */
  tracks: readonly string[] | undefined;
  chrome: 'full' | 'quiet';
  headline: readonly string[];
  layout: ViewLayout;
  speed: number | undefined;
}

type Legacy = ProfileViewerDefaults | undefined;

function inspectorDefaults(view: ViewInfo, legacy: Legacy) {
  const tabs = view.inspector?.tabs ?? [];
  return { inspector: legacy?.inspector ?? view.inspector?.state ?? 'open', tabs, tab: view.inspector?.tab ?? tabs[0] };
}

function stageDefaults(view: ViewInfo, legacy: Legacy) {
  const stage = view.stage ?? {};
  return {
    captions: legacy?.captions ?? stage.captions ?? false,
    steps: stage.steps ?? 'collapsed',
    tracks: stage.tracks,
    chrome: stage.chrome ?? 'full',
  };
}

/** The view's preset, with the legacy `viewer` defaults of the profile that chose it on top. */
export function viewDefaults({ view, profile }: Pick<ResolvedView, 'view' | 'profile'>): ViewDefaults {
  const legacy = profile?.viewer;
  return {
    openAt: legacy?.openAt ?? view.openAt ?? 'start',
    leadMs: legacy?.leadMs ?? view.leadMs ?? DEFAULT_LEAD_MS,
    ...inspectorDefaults(view, legacy),
    ...stageDefaults(view, legacy),
    headline: view.headline ?? [],
    layout: view.layout ?? 'grid',
    speed: view.speed,
  };
}

/** The views in switcher order; ties keep the catalog's order. */
export function switcherViews(views: readonly ViewInfo[]): readonly ViewInfo[] {
  return views.toSorted((a, b) => a.order - b.order);
}

/** The view `step` places after (or before) `current` in the switcher, wrapping around. */
export function cycleView(views: readonly ViewInfo[], current: string, step: 1 | -1): ViewInfo | undefined {
  const ordered = switcherViews(views);
  const index = ordered.findIndex((view) => view.id === current);
  return ordered[(index + step + ordered.length) % ordered.length];
}

/** `search` with `?view=` set to `id`, or without it when `id` is the page's own view; other keys are kept. */
export function writeViewSearch(search: string, id: string, fallback: string) {
  const params = new URLSearchParams(search);
  if (id === fallback) params.delete('view');
  else params.set('view', id);
  const text = params.toString().replaceAll('%2C', ',');
  return text ? `?${text}` : '';
}

/**
 * Inspector tabs in the view's order: listed ids lead in that order, the rest follow as the registry placed them, so no
 * tab is unreachable. Steps (phones) stays first: it is the journey, not a diagnostic.
 */
export function orderTabs<T extends { id: string }>(items: readonly T[], order: readonly string[]): T[] {
  if (!order.length) return [...items];
  const rank = (item: T) => {
    if (item.id === 'steps') return -1;
    const index = order.indexOf(item.id);
    return index < 0 ? order.length : index;
  };
  return items.toSorted((a, b) => rank(a) - rank(b));
}

/** The tab to open: the wanted one when the row has it, else the first the view lists, else the row's first. */
export function availableTab(items: readonly { id: string }[], wanted: string, order: readonly string[] = []) {
  if (items.some((item) => item.id === wanted)) return wanted;
  return order.find((id) => items.some((item) => item.id === id)) ?? items.find((item) => item.id !== 'steps')?.id ?? wanted;
}
