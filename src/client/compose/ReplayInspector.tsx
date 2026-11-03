import type { ReactNode } from 'react';

import type { ReplayBundle } from '../../shared/replay.ts';
import type { Playback } from '../playback/index.ts';

import { collectErrors, type ReplayError } from '../issues.ts';
import { buildNetworkRows, type NetworkRow } from '../viewer/network/model.ts';
import { buildPerformance, type PerformanceModel } from '../viewer/performance.ts';
import { useReplay } from './context.ts';

export interface ReplayInspectorModel {
  console: ReplayBundle['console'];
  network: NetworkRow[];
  performance: PerformanceModel;
  errors: ReplayError[];
  context: ReplayBundle['context'];
  captured: ReplayBundle['meta']['captured'];
  seek: Playback['seek'];
}

/** Portable diagnostic models on this instance's clock, without application tabs or captured-data fallbacks. */
export function useReplayInspector(): ReplayInspectorModel {
  const { bundle, playback } = useReplay();
  return {
    console: bundle.console,
    network: buildNetworkRows(bundle),
    performance: buildPerformance(bundle),
    errors: collectErrors(bundle),
    context: bundle.context,
    captured: bundle.meta.captured,
    seek: playback.seek,
  };
}

/** Place diagnostics anywhere and supply the host's tab system, lists and details through the render prop. */
export function ReplayInspector({ children }: { children: (model: ReplayInspectorModel) => ReactNode }) {
  const model = useReplayInspector();
  return children(model);
}
