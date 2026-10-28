import type { RibbonTone } from './TimeRibbon.tsx';
import './time-ribbon.css';

export interface LocalItem {
  id: string;
  label: string;
  at: number;
  end: number;
  tone?: RibbonTone | undefined;
  /** The item the chart is about: drawn in accent, not a button. */
  current?: boolean;
  /** Right-hand figure, for example "96 ms". */
  value: string;
}

const STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000];
const MAX_TICKS = 5;

/** Offsets from `origin` to the window's end, in ms: a round step that gives at most five ticks. */
function localTicks(origin: number, to: number) {
  const span = Math.max(1, to - origin);
  const step = STEPS.find((candidate) => span / candidate <= MAX_TICKS) ?? STEPS.at(-1) ?? span;
  return Array.from({ length: Math.floor(span / step) + 1 }, (_, index) => index * step);
}

const tick = (ms: number) => {
  if (ms === 0) return '0';
  return ms < 1000 ? `+${ms} ms` : `+${ms / 1000} s`;
};

/**
 * A waterfall on the moment's own scale (a few hundred ms), where bars are legible, unlike on the recording's. Every
 * other row is a button that opens that item (`onPick`); the ruler counts from the item's own start.
 */
export function LocalTimeline({
  from,
  to,
  origin,
  items,
  label,
  onPick,
}: {
  from: number;
  to: number;
  /** The ruler's zero: the start of the item the chart is about. */
  origin: number;
  items: readonly LocalItem[];
  label: string;
  onPick?: ((id: string) => void) | undefined;
}) {
  const span = Math.max(1, to - from);
  const left = (at: number) => `${(Math.max(0, at - from) / span) * 100}%`;
  const width = (item: LocalItem) => `${((Math.min(to, item.end) - Math.max(from, item.at)) / span) * 100}%`;
  return (
    <div className="local-timeline" role="group" aria-label={label}>
      <div className="lt-ruler" aria-hidden="true">
        {localTicks(origin, to).map((offset) => (
          <span key={offset} style={{ left: `${((origin - from + offset) / span) * 100}%` }}>
            {tick(offset)}
          </span>
        ))}
      </div>
      {items.map((item) => {
        const bar = (
          <>
            <span className="lt-label">{item.label}</span>
            <span className="lt-track" aria-hidden="true">
              <span
                className="lt-bar"
                data-tone={item.current ? 'current' : item.tone}
                style={{ left: left(item.at), width: width(item) }}
              />
            </span>
            <span className="lt-value">{item.value}</span>
          </>
        );
        return item.current || !onPick ? (
          <div key={item.id} className="lt-row" data-current={item.current || undefined}>
            {bar}
          </div>
        ) : (
          <button key={item.id} type="button" className="lt-row" onClick={() => onPick(item.id)}>
            {bar}
          </button>
        );
      })}
    </div>
  );
}
