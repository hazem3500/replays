import { MeetingWorkspace } from './MeetingWorkspace.tsx';
import { parseMeetingSearch } from './url.ts';

/**
 * `/compare` as the router renders it today (`?before=&after=`): the meeting view reads the full query itself.
 * `suite` is dropped: a suite compares its runs in its own workspace.
 */
export function ComparisonWorkspace({ beforeId, afterId }: { beforeId: string; afterId: string }) {
  const { suite: _suite, ...query } = Object.fromEntries(new URLSearchParams(location.search));
  return <MeetingWorkspace search={parseMeetingSearch({ before: beforeId, after: afterId, ...query })} />;
}
