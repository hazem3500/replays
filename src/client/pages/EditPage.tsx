import { useQuery } from '@tanstack/react-query';
import { Suspense } from 'react';

import { productName } from '../config.ts';
import { editsQuery } from '../edits.ts';
import { useDocumentTitle } from '../hooks/use-document-title.ts';
import { usePageCode } from '../hooks/use-page-code.ts';
import { replayQuery } from '../queries.ts';
import { replayHref } from '../routing/links.ts';
import { editorPage } from '../routing/pages.ts';
import { FailureShell } from '../routing/states.tsx';
import { SignInError, useSignInRedirect } from '../sign-in.tsx';
import { EditorSkeleton, LoadingSwap } from '../ViewerSkeleton.tsx';

/** The failure edit mode shows, a sign-in failure first (it needs the person, not a retry). */
function failureOf(...candidates: readonly unknown[]): Error | undefined {
  const errors = candidates.filter((candidate): candidate is Error => candidate instanceof Error);
  return errors.find((candidate) => candidate instanceof SignInError) ?? errors[0];
}

function EditFailure({ id, error }: { id: string; error: Error }) {
  return <FailureShell thing="replay" verb="edit" failure={error} back={{ label: 'Back to the replay', href: replayHref(id) }} />;
}

/** Edit mode: the original bundle and the freshest saved edits (always refetched, so a save is never made blind). */
export function EditPage({ id }: { id: string }) {
  const { data: bundle, error: failure } = useQuery(replayQuery(id));
  const edits = useQuery({ ...editsQuery(id), staleTime: 0, refetchOnMount: 'always' });
  const ready = usePageCode(editorPage.loaded, editorPage.preload);
  useDocumentTitle(bundle ? `Edit · ${bundle.meta.title} · ${productName()}` : productName());
  const error = failureOf(failure, edits.error);
  const signingIn = useSignInRedirect(error);
  if (signingIn) return <EditorSkeleton id={id} />;
  if (error) return <EditFailure id={id} error={error} />;
  // why: fresh edits only: a cached copy could be older than someone else's save.
  const loaded = edits.data && !edits.isFetching ? edits.data : undefined;
  const skeleton = <EditorSkeleton id={id} meta={bundle?.meta} edits={edits.data?.stored} steps={bundle?.steps} />;
  return (
    <LoadingSwap ready={Boolean(bundle && loaded) && ready} skeleton={skeleton}>
      {bundle && loaded ? (
        <Suspense fallback={skeleton}>
          <editorPage.Component bundle={bundle} loaded={loaded} />
        </Suspense>
      ) : null}
    </LoadingSwap>
  );
}
