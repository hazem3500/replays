import type { UserPluginManifest } from '../../shared/malleable.ts';
import type { TimelineMarker, ViewerPluginApi } from '../plugins/api.ts';
import { MAX_TRACK_MARKERS } from '../plugins/api.ts';
import { handleCall, type PluginRef } from './broker.ts';
import { mountSandbox } from './sandbox.ts';

/** Project only bounded display data across the frame boundary. */
export function sandboxMarkers(value: unknown): readonly TimelineMarker[] {
  if (!Array.isArray(value) || value.length > MAX_TRACK_MARKERS) throw new TypeError('a track needs at most 500 markers');
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new TypeError('invalid marker');
    const marker = item as Record<string, unknown>;
    if (
      typeof marker.atMs !== 'number' ||
      !Number.isFinite(marker.atMs) ||
      marker.atMs < 0 ||
      typeof marker.label !== 'string' ||
      !marker.label.trim() ||
      marker.label.length > 160
    )
      throw new TypeError('invalid marker position or label');
    if (
      marker.durationMs !== undefined &&
      (typeof marker.durationMs !== 'number' || !Number.isFinite(marker.durationMs) || marker.durationMs < 0)
    )
      throw new TypeError('invalid marker duration');
    const tone = marker.tone;
    if (tone !== undefined && tone !== 'neutral' && tone !== 'info' && tone !== 'warn' && tone !== 'error' && tone !== 'accent')
      throw new TypeError('invalid marker tone');
    return {
      atMs: marker.atMs,
      label: marker.label,
      ...(typeof marker.durationMs === 'number' ? { durationMs: marker.durationMs } : {}),
      ...(tone ? { tone } : {}),
    };
  });
}

/** Both surfaces keep the existing sandbox, policy, frame budget and reload cleanup. */
export function registerSandboxSurfaces(
  api: ViewerPluginApi,
  contributes: UserPluginManifest['contributes'],
  ref: () => PluginRef,
  track: (handle: { dispose(): void }) => () => void,
): void {
  for (const section of contributes.contextSections ?? [])
    api.registerContextSection({
      id: section.id,
      title: section.label,
      render: (container, context) => track(mountSandbox({ plugin: ref(), mode: 'section', contribution: section.id, container, context })),
    });
  for (const contribution of contributes.tracks ?? [])
    api.registerTimelineTrack({
      id: contribution.id,
      label: contribution.label,
      markers: async (context) => {
        let markers: readonly TimelineMarker[] = [];
        const handle = mountSandbox({
          plugin: ref(),
          mode: 'track',
          contribution: contribution.id,
          container: document.body,
          context,
          onMarkers: (value) => {
            markers = sandboxMarkers(value);
          },
        });
        const untrack = track(handle);
        await handle.done;
        untrack();
        return markers;
      },
      onSelect: async (timeMs, context) => {
        await handleCall(ref(), context, 'seek', { ms: timeMs });
      },
    });
}
