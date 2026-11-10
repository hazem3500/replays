import { LANE_LABELS, requestItem, type Lane, type LaneItem } from '../performance/timeline-model.ts';
import type { GutterLane } from '../performance/PerfTimelineParts.tsx';
import { formatDuration, type NetworkRow } from './model.ts';

export const NETWORK_LANE_NAMES = { requests: 'Requests', slow: 'Slow', failed: 'Failed' } as const;

function failedItem(row: NetworkRow): LaneItem {
  return {
    id: `failed:${row.id}`,
    lane: 'failed',
    at: row.at,
    end: row.at,
    verdict: 'poor',
    title: `${row.entry.method} ${row.name.path}`,
    value: row.entry.status ? `${row.entry.status} ${row.entry.statusText}`.trim() : formatDuration(row.end - row.at),
    momentId: row.id,
  };
}

/** The slow and failed requests as marks on their own lanes (a lane with none is not drawn); a mark lights its table row. */
export function buildNetworkLanes(rows: readonly NetworkRow[]): Lane[] {
  const lanes: Lane[] = [
    {
      id: 'request',
      label: LANE_LABELS.request,
      items: rows.filter((row) => row.slow && !row.failed).map((row) => ({ ...requestItem(row), momentId: row.id })),
    },
    { id: 'failed', label: LANE_LABELS.failed, items: rows.filter((row) => row.failed).map(failedItem) },
  ];
  return lanes.filter((lane) => lane.items.length > 0);
}

/** The names in the shared gutter, top to bottom: the density lane, then each mark lane drawn. */
export function networkGutter(lanes: readonly Lane[]): GutterLane[] {
  return [
    { id: 'density', label: NETWORK_LANE_NAMES.requests },
    ...lanes.map((lane): GutterLane => ({
      id: lane.id === 'failed' ? 'failed' : 'slow',
      label: NETWORK_LANE_NAMES[lane.id === 'failed' ? 'failed' : 'slow'],
    })),
  ];
}
