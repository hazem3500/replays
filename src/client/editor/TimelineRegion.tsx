import { useRegionFeedback } from '../hooks/use-region-feedback.ts';
import { useRevealWhen } from '../hooks/use-reveal-when.ts';
import { type PointerEvent as ReactPointerEvent, type ReactNode, useRef } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Hint } from '@/components/icon-button.tsx';
import { usePlayer } from '../player.ts';
import { startDrag, timeKeys, useTimelineScale } from './timeline-drag.ts';

/**
 * One region on a lane (a cut here; zoom, speed, blur and caption regions use it too): drag the body to move it, its
 * edges to resize, × (on hover or when selected) to remove it. A click selects it and shows where it starts. It is
 * a button for the keyboard: arrows move it (Shift: by a second), Delete or Backspace removes it.
 */
export function RegionBlock({
  id,
  kind,
  from,
  to,
  label,
  title,
  selected,
  onSelect,
  onEdit,
  onRemove,
  seekTo,
  children,
}: {
  id: string;
  kind: string;
  from: number;
  to: number;
  /** Short text inside the block when it fits ("4×", a caption). */
  label?: string;
  /** Accessible name and tooltip. */
  title: string;
  selected: boolean;
  onSelect: () => void;
  /** An edge or the whole block moved to `time` (for 'move': the new start); `first`: the first move of a drag. */
  onEdit: (edge: 'from' | 'to' | 'move', time: number, first: boolean) => void;
  onRemove: () => void;
  /** Where a click on it seeks (its start by default; a zoom seeks to where it is fully in). */
  seekTo?: number | undefined;
  children?: ReactNode;
}) {
  const scale = useTimelineScale();
  const player = usePlayer();
  const feedback = useRegionFeedback(selected);
  const left = scale.x(from);
  const naturalWidth = scale.x(to) - left;
  // Captions share a dense lane: preserve timing and a visible gap rather than growing over neighbours.
  const width = kind === 'caption' ? Math.max(1, naturalWidth - 2) : Math.max(6, naturalWidth);
  const showLabel = kind !== 'caption' || width >= 56;
  const length = to - from;
  const edge = (side: 'from' | 'to') => (event: ReactPointerEvent) => {
    onSelect();
    startDrag(event, scale, {
      move: (time, first) => {
        onEdit(side, time, first);
        player.seek(time);
      },
    });
  };
  return (
    <div
      ref={feedback}
      className="tl-region"
      data-kind={kind}
      data-selected={selected || undefined}
      data-narrow={width < 44 || undefined}
      data-compact={width < 88 || undefined}
      data-region-id={id}
      data-testid={`region-${kind}`}
      style={{ left: `${left}px`, width: `${width}px` }}
    >
      <button
        type="button"
        className="tl-region-body"
        aria-label={title}
        aria-pressed={selected}
        title={title}
        onPointerDown={(event) => {
          const offset = scale.timeAt(event.clientX) - from;
          startDrag(event, scale, {
            move: (time, first) => onEdit('move', time - offset, first),
            end: (moved) => {
              onSelect();
              if (!moved) player.seek(seekTo ?? from);
            },
          });
        }}
        onFocus={() => {
          if (!selected) onSelect();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            event.stopPropagation();
            onRemove();
            return;
          }
          timeKeys(event, from, 0, scale.duration - length, (time) => onEdit('move', time, true));
        }}
      >
        {label && showLabel ? <span className="tl-region-label">{label}</span> : null}
        {children}
      </button>
      <span className="tl-region-edge" data-edge="from" aria-hidden="true" onPointerDown={edge('from')}>
        <span className="tl-region-edge-mark" />
      </span>
      <span className="tl-region-edge" data-edge="to" aria-hidden="true" onPointerDown={edge('to')}>
        <span className="tl-region-edge-mark" />
      </span>
      <button
        type="button"
        className="tl-region-remove"
        aria-label={`Remove ${title}`}
        tabIndex={-1}
        data-testid={`remove-${kind}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onRemove}
      >
        <AnimatedIcon name="x" size={12} strokeWidth={2.25} />
      </button>
    </div>
  );
}

/**
 * A lane: its glyph in the gutter (named by a tooltip) and its regions on the track. An empty lane says in place what
 * it is and how to add to it (`empty`), in the quietest text, so it explains itself without hover.
 */
const LANE_LABELS: Record<string, string> = { clip: 'Clip', zoom: 'Zoom', speed: 'Speed', blur: 'Blur', caption: 'Captions' };

export function Lane({
  name,
  icon,
  kind,
  children,
  onTrackPointerDown,
  tall = false,
  empty,
  reveal = false,
}: {
  name: string;
  icon: ReactNode;
  kind: string;
  children: ReactNode;
  onTrackPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  tall?: boolean;
  empty?: string | undefined;
  /** Keyboard and menu-created effects reveal their track in the compact scrolling dock. */
  reveal?: boolean;
}) {
  const lane = useRef<HTMLDivElement>(null);
  useRevealWhen(lane, reveal);
  return (
    <div ref={lane} className="tl-lane" data-kind={kind} data-tall={tall || undefined} role="group" aria-label={name}>
      <Hint label={name} side="left">
        <span className="tl-gutter" aria-hidden="true">
          {icon}
          {LANE_LABELS[kind] ? <span className="tl-gutter-label">{LANE_LABELS[kind]}</span> : null}
        </span>
      </Hint>
      <div className="tl-track" data-testid={`lane-${kind}`} onPointerDown={onTrackPointerDown}>
        {empty ? (
          <span className="tl-lane-empty" aria-hidden="true">
            {empty}
          </span>
        ) : null}
        {children}
      </div>
    </div>
  );
}
