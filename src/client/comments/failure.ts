import { notify } from '../toast.ts';
import { commentStrings } from './strings.ts';

/** A refused or failed write, told plainly: the server's reason when it gave one (rate limit, permission, limits). */
export function reportFailure(error: unknown) {
  notify(error instanceof Error ? error.message : commentStrings.saveFailed, 'error');
}
