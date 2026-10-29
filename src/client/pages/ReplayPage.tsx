import { useQuery } from '@tanstack/react-query';
import { Suspense } from 'react';

import { parseCompareSearch } from '../compare/compare-search.ts';
import { compareDefaults } from '../compare/defaults.ts';
import { productName } from '../config.ts';
import { editsQuery } from '../edits.ts';
import { useDocumentTitle } from '../hooks/use-document-title.ts';
import { useEditsFailureNote } from '../hooks/use-edits-failure-note.ts';
import { useLocationSearch } from '../hooks/use-location-search.ts';
import { usePageCode } from '../hooks/use-page-code.ts';
import { replayQuery } from '../queries.ts';
import { indexHref } from '../routing/links.ts';
import { comparePage, viewerPage } from '../routing/pages.ts';
import { StateShell, TryAgain } from '../routing/states.tsx';
import { SignInError, SignInLink } from '../sign-in.tsx';
import { LoadingSwap, ViewerSkeleton } from '../ViewerSkeleton.tsx';

/** `/r/<id>`: the replay on its own, or with `?with=` the same viewer comparing it with others. */
export function ReplayPage({ id }: { id: string }) {
  const search = useLocationSearch();
  const { compare, layout } = compareDefaults({ page: 'replay', recordings: 1 });
  if (!compare && parseCompareSearch(search, id, layout).with.length === 0) return <SingleReplayPage id={id} />;
  return (
    <Suspense fallback={<ViewerSkeleton label="Loading recordings" />}>
      <comparePage.Component id={id} />
    </Suspense>
  );
}

function SingleReplayPage({ id }: { id: string }) {
  // why: cached bundles (an in-page revisit) render at once; Query aborts the request if the page goes away.
  const { data: bundle, error: failure } = useQuery(replayQuery(id));
  // why: the saved edits come with it (small, revalidated); a failed load shows the replay as recorded.
  const edits = useQuery(editsQuery(id));
  const editsSettled = edits.data !== undefined || edits.isError;
  useEditsFailureNote(Boolean(bundle) && edits.isError && !(edits.error instanceof SignInError));
  const authFailure = [failure, edits.error].find((candidate) => candidate instanceof SignInError);
  const error = (authFailure ?? failure)?.message ?? '';
  const ready = usePageCode(viewerPage.loaded, viewerPage.preload);
  useDocumentTitle(bundle ? `${bundle.meta.title} · ${productName()}` : productName());

  if (error) {
    return (
      <StateShell kicker="Could not open replay" title={error}>
        <SignInLink error={authFailure ?? failure ?? edits.error} />
        <p>
          Replay <code>{id}</code> may have expired or the link may be incomplete.
        </p>
        <div className="state-actions">
          <a className="button" href={indexHref()}>
            Back to all replays
          </a>
          <TryAgain />
        </div>
      </StateShell>
    );
  }

  // why: fast loads skip the delayed skeleton; ready content replaces it immediately.
  return (
    <LoadingSwap ready={Boolean(bundle) && ready && editsSettled} skeleton={<ViewerSkeleton />}>
      {bundle && editsSettled ? (
        <Suspense fallback={<ViewerSkeleton />}>
          <viewerPage.Component bundle={bundle} edits={edits.data} />
        </Suspense>
      ) : null}
    </LoadingSwap>
  );
}
