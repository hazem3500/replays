import type { ReplayBundle } from '../../shared/replay.ts';
import { pageProfiles, replayProfile } from '../profiles.ts';
import { pageViews } from './catalog.ts';
import { type ResolvedView, resolveView } from './resolve.ts';

export interface PageViewInput {
  /** The page's query string; its `view` key names a view. */
  search: string;
  /** The focused recording, once loaded: its profile can name the view. */
  replay?: Pick<ReplayBundle, 'meta'> | undefined;
  /** On a suite page, the suite's profile id. */
  suiteProfile?: string | undefined;
  recordings: number;
}

/** The page's view from the deployment's views and profiles (src/client/views/resolve.ts). */
export function resolvePageView({ search, replay, suiteProfile, recordings }: PageViewInput): ResolvedView {
  const suite = suiteProfile ? pageProfiles().find((profile) => profile.id === suiteProfile) : undefined;
  return resolveView(pageViews(), {
    requested: new URLSearchParams(search).get('view') ?? undefined,
    suiteProfile: suite,
    replayProfile: replay ? replayProfile(replay) : undefined,
    recordings,
  });
}
