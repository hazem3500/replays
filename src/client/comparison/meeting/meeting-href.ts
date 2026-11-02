import { appBase } from '../../route.ts';
import { suiteGridHref } from '../../suite/suite-layout.ts';
import { meetingQuery, type MeetingSearch } from './url.ts';

/**
 * `/compare?…` for a set of recordings. A suite on its own compares its runs in its workspace, so it links there.
 * The first two recordings also ride along as `before`/`after` (ignored next to `ids`), so the link still opens
 * where the router only admits that older form.
 */
export function meetingHref(search: MeetingSearch) {
  if (search.suite && !search.ids?.length) return suiteGridHref(search.suite);
  const query = meetingQuery(search);
  const [before, after] = search.ids ?? [];
  const pair = before && after ? `${query ? '&' : '?'}before=${before}&after=${after}` : '';
  return `${appBase()}/compare${query}${pair}`;
}
