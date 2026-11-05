import { useRegionFeedback } from '../hooks/use-region-feedback.ts';
import { useRevealWhen } from '../hooks/use-reveal-when.ts';
import { useBubblePlacement } from '../hooks/use-bubble-placement.ts';
import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useRef } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Hint } from '@/components/icon-button.tsx';
import { usePlayer } from '../player.ts';
import { blockText } from './BlockLabel.tsx';
import { startDrag, timeKeys, useTimelineScale } from './timeline-drag.ts';

/** What a region shows and where it sits (original ms). */
export interface RegionSpec {
  id: string;
  kind: string;
  from: number;
  to: number;
  /** Short text inside the block when it fits ("4×", a caption). */
  label?: string | undefined;
  /** Accessible name and tooltip. */
  title: string;
  /** Where a click on it seeks (its start by default; a zoom seeks to where it is fully in). */
  seekTo?: number | undefined;
}

/** What a region can do: be selected, have an edge or itself moved to `time` (for `move`, the new start), be removed. */
export interface RegionActions {
  onSelect: () => void;
  /** `first`: the first move of a drag, which starts a new undo step. */
  onEdit: (edge: 'from' | 'to' | 'move', time: number, first: boolean) => void;
  onRemove: () => void;
}

/** A region block's inline padding (editor.css .tl-region-body), which its label's words fit inside. */
const REGION_PAD_PX = 8;

/** A focused block's keys: Delete or Backspace removes it, and the time keys move it. */
function regionKeys(
  event: ReactKeyboardEvent,
  actions: RegionActions,
  { from, to, duration }: { from: number; to: number; duration: number },
) {
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    event.stopPropagation();
    actions.onRemove();
    return;
  }
  timeKeys(event, { value: from, min: 0, max: duration - (to - from) }, (time) => actions.onEdit('move', time, true));
}

/** The block itself, a button: drag it to move the region, click to select and seek, arrows nudge, Delete removes. */
function RegionBody({
  region,
  selected,
  actions,
  width,
}: {
  region: RegionSpec;
  selected: boolean;
  actions: RegionActions;
  /** The block's width in px: how much of its label shows. */
  width: number;
}) {
  const scale = useTimelineScale();
  const player = usePlayer();
  const { from, to, title, label } = region;
  const text = label ? blockText(label, width, { pad: REGION_PAD_PX }) : '';
  return (
    <button
      type="button"
      className="tl-region-body"
      data-short={label && !text ? '' : undefined}
      aria-label={title}
      aria-pressed={selected}
      title={title}
      onPointerDown={(event) => {
        const offset = scale.timeAt(event.clientX) - from;
        startDrag(event, scale, {
          move: (time, first) => actions.onEdit('move', time - offset, first),
          end: (moved) => {
            actions.onSelect();
            if (!moved) player.seek(region.seekTo ?? from);
          },
        });
      }}
      onFocus={() => {
        if (!selected) actions.onSelect();
      }}
      onKeyDown={(event) => regionKeys(event, actions, { from, to, duration: scale.duration })}
    >
      {text ? (
        <span className="tl-region-label" aria-hidden="true">
          {text}
        </span>
      ) : null}
    </button>
  );
}

/** One resize handle: drag it to move that edge; it selects the region and seeks as it goes. */
function RegionEdge({ side, actions }: { side: 'from' | 'to'; actions: RegionActions }) {
  const scale = useTimelineScale();
  const player = usePlayer();
  const onPointerDown = (event: ReactPointerEvent) => {
    actions.onSelect();
    startDrag(event, scale, {
      move: (time, first) => {
        actions.onEdit(side, time, first);
        player.seek(time);
      },
    });
  };
  return (
    <span className="tl-region-edge" data-edge={side} aria-hidden="true" onPointerDown={onPointerDown}>
      <span className="tl-region-edge-mark" />
    </span>
  );
}

/**
 * One region on a lane (a cut here; zoom, speed, blur and caption regions use it too): drag the body to move it, its
 * edges to resize. Selected, it lifts and a Remove bubble floats over its centre, on whichever side of the lane leaves the
 * neighbouring labels clear (next in Tab order; just × on a short region). A click selects it and
 * shows where it starts. It is a button for the keyboard: arrows move it (Shift: by a second), Delete or Backspace
 * removes it.
 */
export function RegionBlock({ region, selected, actions }: { region: RegionSpec; selected: boolean; actions: RegionActions }) {
  const scale = useTimelineScale();
  const feedback = useRegionFeedback(selected);
  const { id, kind, title } = region;
  const left = scale.x(region.from);
  const naturalWidth = scale.x(region.to) - left;
  // why: captions share a dense lane: preserve timing and a visible gap rather than growing over neighbours.
  const width = kind === 'caption' ? Math.max(1, naturalWidth - 2) : Math.max(6, naturalWidth);
  useBubblePlacement(feedback, selected, left, width);
  return (
    <div
      ref={feedback}
      className="tl-region"
      data-kind={kind}
      data-selected={selected || undefined}
      data-compact={width < 88 || undefined}
      data-region-id={id}
      data-testid={`region-${kind}`}
      style={{ left: `${left}px`, width: `${width}px` }}
    >
      <RegionBody region={region} selected={selected} actions={actions} width={width} />
      <RegionEdge side="from" actions={actions} />
      <RegionEdge side="to" actions={actions} />
      <Hint label={`Remove ${title}`} shortcut="Delete">
        <button
          type="button"
          className="tl-region-remove"
          aria-label={`Remove ${title}`}
          aria-keyshortcuts="Delete"
          tabIndex={selected ? 0 : -1}
          data-testid={`remove-${kind}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={actions.onRemove}
        >
          <AnimatedIcon name="x" size={11} strokeWidth={2.25} />
          <span aria-hidden="true">Remove</span>
        </button>
      </Hint>
    </div>
  );
}

/**
 * A lane: its glyph in the gutter, in the lane's kind colour and named by a tooltip, and its regions on the track. An
 * empty lane says in place what it is and how to add to it (`empty`), in the quietest text, so it explains itself.
 */

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
