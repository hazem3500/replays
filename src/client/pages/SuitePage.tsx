import { Suspense } from 'react';

import { usePageCode } from '../hooks/use-page-code.ts';
import { suitePage } from '../routing/pages.ts';
import { LoadingSwap, ViewerSkeleton } from '../ViewerSkeleton.tsx';

/** The suite workspace, on the run in the address (`/s/<suite>/r/<id>`); it stays mounted across run switches. */
export function SuitePage({ id, replayId }: { id: string; replayId?: string | undefined }) {
  const ready = usePageCode(suitePage.loaded, suitePage.preload);
  // why: fast loads skip the delayed skeleton; ready content replaces it immediately.
  return (
    <LoadingSwap ready={ready} skeleton={<ViewerSkeleton suite />}>
      <Suspense fallback={<ViewerSkeleton suite />}>
        <suitePage.Component id={id} {...(replayId ? { replayId } : {})} />
      </Suspense>
    </LoadingSwap>
  );
}
