import { useQuery } from '@tanstack/react-query';
import { Suspense } from 'react';

import { productName } from '../config.ts';
import { editsQuery } from '../edits.ts';
import { useDocumentTitle } from '../hooks/use-document-title.ts';
import { usePageCode } from '../hooks/use-page-code.ts';
import { replayQuery } from '../queries.ts';
import { replayHref } from '../routing/links.ts';
import { Editor, editorLoaded, loadEditor } from '../routing/pages.ts';
import { StateShell, TryAgain } from '../routing/states.tsx';
import { SignInError, SignInLink } from '../sign-in.tsx';
import { EditorSkeleton, LoadingSwap } from '../ViewerSkeleton.tsx';

/** Edit mode: the original bundle and the freshest saved edits (always refetched, so a save is never made blind). */
export function EditPage({ id }: { id: string }) {
  const { data: bundle, error: failure } = useQuery(replayQuery(id));
  const edits = useQuery({ ...editsQuery(id), staleTime: 0, refetchOnMount: 'always' });
  const ready = usePageCode(editorLoaded, loadEditor);
  useDocumentTitle(bundle ? `Edit · ${bundle.meta.title} · ${productName()}` : productName());
  const authFailure = [failure, edits.error].find((candidate) => candidate instanceof SignInError);
  const error = (authFailure ?? failure ?? edits.error)?.message ?? '';
  if (error) {
    return (
      <StateShell kicker="Could not open edit mode" title={error}>
        <SignInLink error={authFailure ?? failure ?? edits.error} />
        <div className="state-actions">
          <a className="button" href={replayHref(id)}>
            Back to the replay
          </a>
          <TryAgain />
        </div>
      </StateShell>
    );
  }
  // why: fresh edits only: a cached copy could be older than someone else's save.
  const loaded = edits.data && !edits.isFetching ? edits.data : undefined;
  return (
    <LoadingSwap ready={Boolean(bundle && loaded) && ready} skeleton={<EditorSkeleton />}>
      {bundle && loaded ? (
        <Suspense fallback={<EditorSkeleton />}>
          <Editor bundle={bundle} loaded={loaded} />
        </Suspense>
      ) : null}
    </LoadingSwap>
  );
}
