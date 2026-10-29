import { formatClock, type ReplayStep } from '../../../shared/replay.ts';
import { type LocalItem, LocalTimeline } from '../LocalTimeline.tsx';
import { DetailHead } from '../network/DetailHead.tsx';
import { formatDuration, type NetworkRow, stepAt } from '../network/model.ts';
import type { RibbonTone } from '../TimeRibbon.tsx';
import { BudgetBar, MOMENT_DETAIL_ID } from './MomentList.tsx';
import { BUDGETS, causeOf, causeText, type Moment, VERDICT_WORDS, type Verdict } from './model.ts';

const STRINGS = {
  close: 'Close moment',
  interaction: 'From the input to the next frame. People notice a delay over 200 ms; over 500 ms feels broken.',
  task: 'The main thread was busy the whole time, so clicks, typing and rendering waited for it.',
  budget: (good: number, poor: number) => `Good under ${formatDuration(good)}, poor over ${formatDuration(poor)}`,
  when: 'When',
  during: 'During',
  waited: 'Waited on',
  after: (ms: number) => `${formatDuration(ms)} after it began`,
  around: 'Around this moment',
  attribution: 'Script attribution isn’t captured, so which code ran is not known.',
};

/** Margin around a moment for its neighbourhood chart, in ms. */
const AROUND_PAD_MS = 300;
const AROUND_MAX_REQUESTS = 8;

const TONES: Readonly<Record<Verdict, RibbonTone>> = { poor: 'danger', 'needs-work': 'warning', good: 'neutral' };

function aroundItems(
  target: Moment,
  moments: readonly Moment[],
  requests: readonly NetworkRow[],
  span: { from: number; to: number },
): LocalItem[] {
  const { from, to } = span;
  const inWindow = (item: { at: number; end: number }) => item.end >= from && item.at <= to;
  const momentItems = moments.filter(inWindow).map((item) => ({
    id: item.id,
    label: item.label,
    at: item.at,
    end: item.end,
    tone: TONES[item.verdict],
    current: item.id === target.id,
    value: formatDuration(item.value),
  }));
  const requestItems = requests
    .filter((row) => inWindow({ at: row.at, end: Math.max(row.end, row.at) }))
    .slice(0, AROUND_MAX_REQUESTS)
    .map((row) => ({
      id: `request:${row.id}`,
      label: `${row.entry.method} ${row.name.path}`,
      at: row.at,
      end: row.end,
      tone: row.failed ? ('danger' as const) : undefined,
      value: row.measured === undefined ? '?' : formatDuration(row.measured),
    }));
  return [...momentItems, ...requestItems].toSorted((a, b) => a.at - b.at);
}

/**
 * The selected moment: what it means, its value against budget, the step it was during and what it most likely waited
 * on, then everything around it on its own scale. A request there opens in the Network tab.
 */
export function MomentDetail({
  moment,
  moments,
  requests,
  steps,
  stacked,
  onSelect,
  onOpenRequest,
}: {
  moment: Moment;
  moments: readonly Moment[];
  requests: readonly NetworkRow[];
  steps: readonly ReplayStep[];
  stacked: boolean;
  onSelect: (id?: string) => void;
  onOpenRequest: (id: string) => void;
}) {
  const [good, poor] = moment.kind === 'task' ? BUDGETS.task : BUDGETS.interaction;
  const from = moment.at - AROUND_PAD_MS;
  const to = moment.end + AROUND_PAD_MS;
  const close = () => {
    onSelect();
    requestAnimationFrame(() => document.getElementById(`moment-switch-${moment.id}`)?.focus());
  };
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- why: Escape anywhere in the open detail closes it and returns focus to its row.
    <section
      id={MOMENT_DETAIL_ID}
      className="np-detail pp-detail"
      aria-label="Selected performance evidence"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        close();
      }}
    >
      <DetailHead at={moment.at} stacked={stacked} closeLabel={STRINGS.close} onClose={close}>
        <span className="pp-dot" data-verdict={moment.verdict} aria-hidden="true" />
        <strong>{moment.label}</strong>
        <span>{formatDuration(moment.value)}</span>
        <span className="pp-verdict" data-verdict={moment.verdict}>
          {VERDICT_WORDS[moment.verdict]}
        </span>
      </DetailHead>
      <div className="pp-meaning">
        <p>{moment.kind === 'task' ? STRINGS.task : STRINGS.interaction}</p>
        <BudgetBar moment={moment} />
        <p className="np-aside">{STRINGS.budget(good, poor)}</p>
      </div>
      <MomentFacts moment={moment} moments={moments} requests={requests} steps={steps} />
      <section className="np-section">
        <h3>{STRINGS.around}</h3>
        <LocalTimeline
          from={from}
          to={to}
          origin={moment.at}
          items={aroundItems(moment, moments, requests, { from, to })}
          label={STRINGS.around}
          onPick={(id) => (id.startsWith('request:') ? onOpenRequest(id.slice('request:'.length)) : onSelect(id))}
        />
      </section>
      <p className="np-note">{STRINGS.attribution}</p>
    </section>
  );
}

function MomentFacts({
  moment,
  moments,
  requests,
  steps,
}: {
  moment: Moment;
  moments: readonly Moment[];
  requests: readonly NetworkRow[];
  steps: readonly ReplayStep[];
}) {
  const step = stepAt(steps, moment.at);
  const cause = causeText(causeOf(moment, moments, requests));
  return (
    <dl className="np-facts">
      <dt>{STRINGS.when}</dt>
      <dd>{formatClock(moment.at)}</dd>
      {step ? (
        <>
          <dt>{STRINGS.during}</dt>
          <dd>
            {step.label}
            <span className="np-aside">{STRINGS.after(Math.max(0, moment.at - step.at))}</span>
          </dd>
        </>
      ) : null}
      {cause ? (
        <>
          <dt>{STRINGS.waited}</dt>
          <dd>{`${cause.charAt(0).toUpperCase()}${cause.slice(1)}`}</dd>
        </>
      ) : null}
    </dl>
  );
}
