import { isRecord } from '../../shared/validate.ts';
import type { UserPluginManifest } from '../../shared/malleable.ts';
import type { TimelineMarker, TimelineTone, ViewerPluginApi } from '../plugins/api.ts';
import { MAX_TRACK_MARKERS } from '../plugins/api.ts';
import { handleCall, type PluginRef } from './broker.ts';
import { mountSandbox } from './sandbox.ts';

function markerTone(value: unknown): value is TimelineTone {
  return value === 'neutral' || value === 'info' || value === 'warn' || value === 'error' || value === 'accent';
}

function markerTime(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TypeError('invalid marker time');
  return value;
}

function markerLabel(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 160) throw new TypeError('invalid marker label');
  return value;
}

function markerFrom(value: unknown): TimelineMarker {
  if (!isRecord(value)) throw new TypeError('invalid marker');
  const atMs = markerTime(value.atMs);
  const label = markerLabel(value.label);
  const durationMs = value.durationMs === undefined ? undefined : markerTime(value.durationMs);
  const { tone } = value;
  if (tone !== undefined && !markerTone(tone)) throw new TypeError('invalid marker tone');
  return { atMs, label, ...(typeof durationMs === 'number' ? { durationMs } : {}), ...(tone ? { tone } : {}) };
}

/** Project only bounded display data across the frame boundary. */
export function sandboxMarkers(value: unknown): readonly TimelineMarker[] {
  if (!Array.isArray(value) || value.length > MAX_TRACK_MARKERS) throw new TypeError('a track needs at most 500 markers');
  return value.map(markerFrom);
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
