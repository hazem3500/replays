import { BUILT_IN_VIEWS, type ViewInfo } from '../../shared/views.ts';
import { pageMeta } from '../page-meta.ts';

const BUILT_INS: readonly ViewInfo[] = BUILT_IN_VIEWS.map((view) => ({ ...view, order: view.order ?? 0, builtIn: true }));

let cached: readonly ViewInfo[] | undefined;
let override: readonly ViewInfo[] | undefined;

function isViewInfo(item: unknown): item is ViewInfo {
  return (
    typeof item === 'object' &&
    item !== null &&
    'id' in item &&
    typeof item.id === 'string' &&
    'label' in item &&
    typeof item.label === 'string'
  );
}

/**
 * The deployment's views in switcher order, as the server wrote them into the page (`<meta name="app-views">`). A page
 * without the meta (a static build, an older server) offers the built-in views.
 */
export function pageViews(): readonly ViewInfo[] {
  if (override) return override;
  if (cached) return cached;
  let views: readonly ViewInfo[] = BUILT_INS;
  try {
    const content = pageMeta('app-views');
    const parsed: unknown = content ? JSON.parse(content) : undefined;
    const listed = Array.isArray(parsed) ? parsed.filter(isViewInfo) : [];
    if (listed.length) views = listed.map((view) => ({ ...view, order: Number.isFinite(view.order) ? view.order : 0 }));
  } catch {
    views = BUILT_INS;
  }
  // invariant: only the browser's page caches them; a server renders requests for different hosts in one process.
  if (typeof document !== 'undefined') cached = views;
  return views;
}

/** Tests and stories only. */
export function setPageViewsForTests(value: readonly ViewInfo[] | undefined) {
  override = value;
  cached = undefined;
}
