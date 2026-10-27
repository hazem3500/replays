import { type CSSProperties, type KeyboardEvent, memo, useContext, useEffect, useRef, useState } from 'react';

import { formatClock } from '../../shared/replay.ts';
import { usePlayer } from '../player.ts';
import { ContextSection } from '../viewer/ContextPanel.tsx';
import type { TimelineTrackDefinition, ViewerPluginContext } from './api.ts';
import { PluginContexts, PluginMount, usePluginSnapshot } from './PluginUi.tsx';
import { type PlacedMarker, placeMarkers } from './tracks.ts';
import './plugin-slots.css';

/*
 * Client plugins' slots inside built-in views: timeline tracks under the seek bar (drawn in the scrubber's overlay
 * layer, like the comment markers) and blocks inside the Context tab. Both need the viewer's PluginContexts.
 */

/** Rows of plugin markers under the seek bar's bars; `width` and `inset` are the scrubber's track geometry. */
export const PluginTimelineTracks = memo(function PluginTimelineTracks({ width, inset }: { width: number; inset: number }) {
  const contextFor = useContext(PluginContexts);
  const tracks = usePluginSnapshot().tracks;
  if (!contextFor || tracks.length === 0 || width <= 0) return null;
  return (
    <div className="plugin-tracks" data-slot="viewer.scrubber.tracks" data-testid="plugin-tracks">
      {tracks.map((track, row) => (
        <TrackRow
          key={track.key}
          testId={`plugin-track:${track.plugin}:${track.definition.id}`}
          track={track.definition}
          context={contextFor(track.plugin)}
          row={row}
          width={width}
          inset={inset}
        />
      ))}
    </div>
  );
});

function TrackRow({
  track,
  context,
  row,
  width,
  inset,
  testId,
}: {
  track: TimelineTrackDefinition;
  context: ViewerPluginContext;
  row: number;
  width: number;
  inset: number;
  testId: string;
}) {
  const player = usePlayer();
  const duration = player.duration;
  const [markers, setMarkers] = useState<PlacedMarker[]>([]);
  const element = useRef<HTMLDivElement>(null);
  // Asked once per replay (the context is per replay); a late answer for a replay no longer open is ignored.
  useEffect(() => {
    let live = true;
    void Promise.resolve()
      .then(() => track.markers(context))
      .then((raw) => {
        if (!live) return;
        const placed = placeMarkers(raw, duration);
        if (placed.dropped) console.warn(`timeline track "${track.label}": ${placed.dropped} markers left out (invalid or over the cap)`);
        setMarkers(placed.markers);
      })
      .catch((error: unknown) => console.error(`timeline track "${track.label}" failed:`, error));
    return () => {
      live = false;
    };
  }, [track, context, duration]);
  if (markers.length === 0 || duration <= 0) return null;
  const toX = (ms: number) => (Math.min(duration, Math.max(0, ms)) / duration) * width;
  // One tab stop per track; arrow keys walk its markers.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    const buttons = [...(element.current?.querySelectorAll<HTMLButtonElement>('.plugin-track-hit') ?? [])];
    const index = buttons.indexOf(event.currentTarget);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : Math.min(buttons.length - 1, Math.max(0, index + (event.key === 'ArrowRight' ? 1 : -1)));
    event.preventDefault();
    event.stopPropagation();
    buttons[next]?.focus();
  };
  return (
    <div
      ref={element}
      className="plugin-track"
      data-slot-item={testId.replace(/^plugin-track:/, 'plugin:')}
      style={{ '--track-row': row } as CSSProperties}
      data-testid={testId}
    >
      {markers.map((marker, index) => {
        const x = inset + toX(marker.at);
        const span = marker.duration ? Math.max(3, toX(marker.at + marker.duration) - toX(marker.at)) : 0;
        const side = x < 130 ? 'start' : x > width - 130 ? 'end' : 'center';
        return (
          <div
            key={`${marker.at}-${index}`}
            className="plugin-track-marker"
            data-tone={marker.tone}
            data-range={span ? '' : undefined}
            data-side={side}
            style={{ left: `${x}px`, ...(span ? { width: `${span}px` } : {}) }}
          >
            <button
              type="button"
              className="plugin-track-hit"
              data-testid="plugin-track-marker"
              tabIndex={index === 0 ? 0 : -1}
              aria-label={`${track.label}: ${marker.label}, at ${formatClock(marker.at)}`}
              onClick={() => context.seek(marker.at)}
              onKeyDown={onKeyDown}
            />
            <div className="plugin-track-card" aria-hidden="true">
              <span className="plugin-track-card-head">
                {track.label} · {formatClock(marker.at)}
                {marker.duration ? `–${formatClock(marker.at + marker.duration)}` : ''}
              </span>
              <span className="plugin-track-card-label">{marker.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The plugins' blocks for the Context tab, in order; nothing without a viewer around it. */
export function usePluginContextSections() {
  const contextFor = useContext(PluginContexts);
  const sections = usePluginSnapshot().contextSections;
  if (!contextFor || sections.length === 0) return undefined;
  return sections.map((section) => (
    <ContextSection key={section.key} title={section.definition.title} testId={`${section.key}-section`}>
      <PluginMount
        render={section.definition.render}
        slot="viewer.context.sections"
        itemId={section.key}
        context={contextFor(section.plugin)}
        label={section.definition.title}
        className="plugin-mount ctx-plugin-body"
      />
    </ContextSection>
  ));
}
