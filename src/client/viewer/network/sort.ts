import type { ReplayStep } from '../../../shared/replay.ts';
import type { NetworkColumnKey } from './columns.ts';
import type { NetworkRow } from './model.ts';

export interface NetworkSort {
  key: NetworkColumnKey;
  direction: 'ascending' | 'descending';
}

function during(row: NetworkRow, steps: readonly ReplayStep[]) {
  return steps.findLast((step) => step.at <= row.at)?.label ?? '';
}

/** Sorts display rows without changing captured identity or measured timing. */
export function sortNetworkRows(rows: readonly NetworkRow[], sort: NetworkSort, steps: readonly ReplayStep[]): NetworkRow[] {
  const value = (row: NetworkRow): number | string => {
    switch (sort.key) {
      case 'time':
        return row.at;
      case 'request':
        return row.entry.url;
      case 'status':
        return row.entry.status;
      case 'duration':
        return row.measured ?? Number.POSITIVE_INFINITY;
      case 'during':
        return during(row, steps);
    }
  };
  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    const order =
      typeof left === 'number' && typeof right === 'number'
        ? left === right
          ? 0
          : left < right
            ? -1
            : 1
        : String(left).localeCompare(String(right));
    return (sort.direction === 'ascending' ? order : -order) || a.at - b.at || a.id.localeCompare(b.id);
  });
}
