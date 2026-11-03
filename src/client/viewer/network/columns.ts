import { resolveSlot } from '../../plugins/registry.ts';
import { surfaceValue } from '../../plugins/HostSurface.tsx';
import type { HostSurfaceContext, HostSurfaceDefinition } from '../../plugins/surface-contracts.ts';

export type NetworkColumnKey = 'time' | 'request' | 'status' | 'duration' | 'during';
interface CoreColumn {
  readonly key: NetworkColumnKey;
  readonly label: string;
  readonly width: string;
}
export interface NetworkColumn {
  readonly id: string;
  readonly label: string;
  readonly width: string;
  readonly key?: NetworkColumnKey;
  readonly render?: HostSurfaceDefinition['render'];
}

const CORE: readonly CoreColumn[] = [
  { key: 'time', label: 'Time', width: '60px' },
  { key: 'request', label: 'Request', width: 'minmax(160px, 1fr)' },
  { key: 'status', label: 'Status', width: '52px' },
  { key: 'duration', label: 'Duration', width: '116px' },
  { key: 'during', label: 'During', width: 'minmax(100px, 200px)' },
];

/** Column factories describe the whole table; DOM renderers receive the captured request for each visible row. */
export function networkColumns(context: HostSurfaceContext): readonly NetworkColumn[] {
  return resolveSlot<HostSurfaceContext, CoreColumn | HostSurfaceDefinition>(
    'inspector.network.columns',
    CORE.map((column, index) => ({
      id: `core:${column.key}`,
      order: (index + 1) * 100,
      render: () => column,
    })),
    context,
  ).flatMap((item): NetworkColumn[] => {
    const value = surfaceValue(item, context);
    if (!value) return [];
    if ('key' in value) return [{ id: item.id, ...value }];
    if (typeof value.label !== 'string' || typeof value.render !== 'function') return [];
    return [
      {
        id: item.id,
        label: value.label,
        width: value.width ?? '120px',
        render: (container, rowContext) => value.render(container, rowContext),
      },
    ];
  });
}

export function defaultNetworkColumns(columns: readonly NetworkColumn[]): boolean {
  return columns.length === CORE.length && columns.every((column, index) => column.id === `core:${CORE[index]?.key}`);
}
