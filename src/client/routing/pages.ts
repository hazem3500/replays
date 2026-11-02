import { lazyPage } from './lazy-page.ts';

let features: Promise<void> | undefined;
/**
 * The viewer's built-in features (comments: provider, tab, seek-bar markers), registered with the code that renders
 * them, so the index's bundle never carries the player they depend on.
 */
const viewerFeatures = () => (features ??= import('../comments/feature.tsx').then((module) => module.registerCommentsFeature()));

const withFeatures = <M>(load: () => Promise<M>) => () => Promise.all([load(), viewerFeatures()]).then(([module]) => module);

/** The pages that ship as their own chunks; the index ships in the main bundle. */
export const viewerPage = lazyPage(
  withFeatures(() => import('../Viewer.tsx')),
  (module) => module.EditedViewer,
);
export const editorPage = lazyPage(
  withFeatures(() => import('../editor/Editor.tsx')),
  (module) => module.Editor,
);
export const suitePage = lazyPage(
  withFeatures(() => import('../suite/SuiteWorkspace.tsx')),
  (module) => module.SuiteWorkspace,
);
export const comparisonPage = lazyPage(
  () => import('../comparison/meeting/MeetingWorkspace.tsx'),
  (module) => module.MeetingWorkspace,
);

/** Code for a route, warmed by its loader; failures surface when the page renders. */
export const warm = (page: { preload: () => Promise<unknown> }) => void page.preload().catch(() => undefined);
