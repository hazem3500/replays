import { useEffect } from 'react';

import { notify } from '../toast.ts';

/** One quiet note when a replay's saved edits could not be loaded: it plays as recorded. */
export function useEditsFailureNote(failed: boolean) {
  useEffect(() => {
    if (failed) notify('Could not load this replay’s edits', 'info', 'Showing it as recorded.');
  }, [failed]);
}
