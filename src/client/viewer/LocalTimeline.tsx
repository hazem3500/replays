import { RequestLabel } from './network/RequestLabel.tsx';
import type { RibbonTone } from './TimeRibbon.tsx';
// oxlint-disable-next-line import/no-unassigned-import -- why: the chart's styles load with the lazy inspector chunk, not with every page.
import './time-ribbon.css';

export interface LocalItem {
  id: string;
  label: string;
  /** A request: drawn as a method and a shortened path with the full URL as its tooltip, instead of `label`. */
  request?: { method: string; path: string; url: string } | undefined;
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

/** Labels a tick only when it clears the last labelled one, as a share of the ruler; the marks always draw. */
const LABEL_GAP = 0.28;

const tick = (ms: number) => {
  if (ms === 0) return '0';
  return ms < 1000 ? `+${ms} ms` : `+${ms / 1000} s`;
};

function labelledTicks(ticks: readonly { offset: number; position: number }[]) {
  let last = -Infinity;
  return ticks.map((item) => {
    const labelled = item.position - last >= LABEL_GAP;
    if (labelled) last = item.position;
    return { ...item, labelled };
  });
}

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
        {labelledTicks(localTicks(origin, to).map((offset) => ({ offset, position: (origin - from + offset) / span }))).map((item) => (
          <span key={item.offset} style={{ left: `${item.position * 100}%` }}>
            {item.labelled ? <span className="lt-tick-label">{tick(item.offset)}</span> : null}
          </span>
        ))}
      </div>
      {items.map((item) => {
        const bar = (
          <>
            <span className="lt-label" title={item.request?.url ?? item.label}>
              {item.request ? <RequestLabel {...item.request} /> : item.label}
            </span>
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
        return item.current === true || !onPick ? (
          <div key={item.id} className="lt-row" data-current={item.current === true ? '' : undefined}>
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
