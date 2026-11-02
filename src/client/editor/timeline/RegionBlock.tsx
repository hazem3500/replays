import { XIcon } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';

import { usePlayer } from '../../player.ts';
import { startDrag, timeKeys, useMobileTimeline, useTimelineScale } from './scale.ts';

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
  const mobile = useMobileTimeline();
  const player = usePlayer();
  const left = scale.x(from);
  const naturalWidth = scale.x(to) - left;
  // Captions share a dense lane: preserve timing and a visible gap rather than growing over neighbours.
  const width = kind === 'caption' ? Math.max(1, naturalWidth - 2) : Math.max(6, naturalWidth);
  const showLabel = kind !== 'caption' || width >= (label?.length ?? 0) * 6.5 + 24;
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
      className="tl-region"
      data-kind={kind}
      data-selected={selected || undefined}
      data-narrow={width < 44 || undefined}
      data-compact={width < 72 || undefined}
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
              if (mobile) player.pause();
              if (!moved) player.seek(seekTo ?? from);
            },
          });
        }}
        onFocus={() => {
          if (!mobile && !selected) onSelect();
        }}
        onClick={(event) => {
          if (!mobile || event.detail !== 0) return;
          onSelect();
          player.seek(seekTo ?? from);
          if (mobile) player.pause();
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
      <span className="tl-region-edge" data-edge="from" aria-hidden="true" onPointerDown={edge('from')} />
      <span className="tl-region-edge" data-edge="to" aria-hidden="true" onPointerDown={edge('to')} />
      <button
        type="button"
        className="tl-region-remove"
        aria-label={`Remove ${title}`}
        tabIndex={-1}
        data-testid={`remove-${kind}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onRemove}
      >
        <XIcon aria-hidden="true" />
      </button>
    </div>
  );
}
