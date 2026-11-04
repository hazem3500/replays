import { editTimeline, type TimelineEdits } from '../../shared/edit-timeline.ts';
import { useTimelineScale } from './timeline-drag.ts';
import { activityOf, removedSlices } from './timeline-marks.ts';

/** The shortest bar drawn for a slice with any activity, in the strip's 0 to 100 height. */
const MIN_BAR = 8;
/** The tallest bar, leaving the clip's edge clear. */
const MAX_BAR = 92;

/**
 * Where the action is, drawn quietly inside the clip: one bar per slice of the recording from its pointer moves,
 * scrolls, typing and clicks, with clicks and typing in a firmer tone. Bars the trim or a cut removes dim.
 * Decorative: the steps and the clip carry the same facts for assistive technology.
 */
export function TimelineActivity({
  events,
  duration,
  edits,
}: {
  events: ReadonlyArray<{ timestamp: number; type?: unknown; data?: unknown }>;
  duration: number;
  edits: TimelineEdits;
}) {
  const scale = useTimelineScale();
  const bars = activityOf(events, duration);
  if (!bars.length || scale.width <= 0) return null;
  const timeline = editTimeline(edits, duration);
  const removed = removedSlices(bars.length, duration, (time) => timeline.isRemoved(time));
  return (
    <svg
      className="tl-activity"
      aria-hidden="true"
      focusable="false"
      data-testid="clip-activity"
      style={{ left: `${scale.x(0)}px`, width: `${scale.width}px` }}
      viewBox={`0 0 ${bars.length} 100`}
      preserveAspectRatio="none"
    >
      {bars.map((bar, index) => {
        if (bar.level <= 0) return null;
        const height = MIN_BAR + bar.level * (MAX_BAR - MIN_BAR);
        return (
          <rect
            // oxlint-disable-next-line react/no-array-index-key -- why: a bar is its slice of time; the slices never reorder.
            key={index}
            x={index + 0.22}
            width={0.56}
            y={100 - height}
            height={height}
            data-strong={bar.strong || undefined}
            data-removed={removed[index] ? true : undefined}
          />
        );
      })}
    </svg>
  );
}
