import { useQuery } from '@tanstack/react-query';

import { StateView } from '@/components/ui/state-view.tsx';

import { pageProfiles } from '../profiles.ts';
import { expiredReason, expiredReplaysQuery } from '../index/expired-query.ts';

/**
 * A suite whose every recording retention removed: says so plainly and, when the server kept a record of the removal,
 * when and under which window it happened. "Keep suite" is the way to stop it next time.
 */
export function SuiteExpired({ replayIds }: { replayIds: readonly string[] }) {
  const { data } = useQuery(expiredReplaysQuery);
  const record = data?.records.find((item) => replayIds.includes(item.id));
  return (
    <StateView
      kind="not-found"
      title="These recordings are no longer available"
      cause={`${record ? `${expiredReason(record, pageProfiles())}.` : 'Retention removed them once their window passed.'} Use Keep suite to hold on to a suite’s recordings next time.`}
    />
  );
}
