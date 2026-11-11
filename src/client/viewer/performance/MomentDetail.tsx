import { formatClock, type ReplayStep } from '../../../shared/replay.ts';
import { usePlayer } from '../../player.ts';
import { type LocalItem, LocalTimeline } from '../LocalTimeline.tsx';
import { DetailHead } from '../network/DetailHead.tsx';
import { RequestLabel } from '../network/RequestLabel.tsx';
import { formatDuration, type NetworkRow, stepAt, stepName } from '../network/model.ts';
import type { RibbonTone } from '../TimeRibbon.tsx';
import { BlockingScripts } from './BlockingScripts.tsx';
import { InteractionBreakdown } from './InteractionBreakdown.tsx';
import { MOMENT_DETAIL_ID } from './MomentList.tsx';
import { BUDGETS, causeOf, interactionLabel, type Moment, VERDICT_WORDS, type Verdict } from './model.ts';

const STRINGS = {
  close: 'Close moment',
  budget: (good: number, poor: number) => `Good under ${formatDuration(good)}, poor over ${formatDuration(poor)}`,
  when: 'When',
  during: 'During',
  why: 'Why',
  after: (ms: number) => `${formatDuration(ms)} after it began`,
  around: 'Around this moment',
  blockedBy: (ms: number) => `A ${formatDuration(ms)} long task blocked the page`,
  seekTask: 'Go to the long task',
  inFlight: (count: number) => `${count} ${count === 1 ? 'request was' : 'requests were'} in flight`,
  more: (count: number) => `and ${count} more in the Network tab`,
  page: 'No request was in flight, so the page’s own code ran long.',
  taskIdle: 'The main thread was busy the whole time, so clicks, typing and rendering waited for it.',
  attribution: 'Which script ran is not captured.',
};

/** Margin around a moment for its neighbourhood chart, in ms. */
const AROUND_PAD_MS = 300;
const AROUND_MAX_REQUESTS = 8;
const WHY_MAX_REQUESTS = 4;

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
      request: { method: row.entry.method, path: row.name.path, url: row.entry.url },
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
        <strong>{moment.interaction ? interactionLabel([moment.interaction.eventType]) : moment.label}</strong>
        <span>{formatDuration(moment.value)}</span>
        <span className="pp-verdict" data-verdict={moment.verdict}>
          {VERDICT_WORDS[moment.verdict]}
        </span>
      </DetailHead>
      <p className="np-aside pp-budget-line">{STRINGS.budget(good, poor)}</p>
      <MomentFacts moment={moment} moments={moments} requests={requests} steps={steps} onOpenRequest={onOpenRequest} />
      <MomentWhy moment={moment} />
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
    </section>
  );
}

/**
 * What the recorder captured about why: an interaction's phases, then the scripts of its long animation frame. Both
 * components are self-contained, so any row detail container can render them.
 */
export function MomentWhy({ moment }: { moment: Moment }) {
  return (
    <>
      {moment.interaction ? <InteractionBreakdown interaction={moment.interaction} /> : null}
      {moment.frame ? <BlockingScripts frame={moment.frame} /> : null}
    </>
  );
}

function MomentFacts({
  moment,
  moments,
  requests,
  steps,
  onOpenRequest,
}: {
  moment: Moment;
  moments: readonly Moment[];
  requests: readonly NetworkRow[];
  steps: readonly ReplayStep[];
  onOpenRequest: (id: string) => void;
}) {
  const player = usePlayer();
  const step = stepAt(steps, moment.at);
  const cause = causeOf(moment, moments, requests);
  return (
    <dl className="np-facts">
      <dt>{STRINGS.when}</dt>
      <dd>{formatClock(moment.at)}</dd>
      {step ? (
        <>
          <dt>{STRINGS.during}</dt>
          <dd>
            <button type="button" className="pp-link" onClick={() => player.seek(step.at)}>
              {stepName(step.label)}
            </button>
            <span className="np-aside">{STRINGS.after(Math.max(0, moment.at - step.at))}</span>
          </dd>
        </>
      ) : null}
      <dt>{STRINGS.why}</dt>
      <dd>
        {cause.kind === 'task' ? (
          <>
            <button type="button" className="pp-link" onClick={() => player.seek(cause.task.at)}>
              {STRINGS.blockedBy(cause.task.value)}
            </button>
            {cause.task.frame ? null : <span className="np-aside">{STRINGS.attribution}</span>}
          </>
        ) : null}
        {cause.kind === 'network' ? (
          <>
            {STRINGS.inFlight(cause.requests.length)}
            <ul className="pp-inflight">
              {cause.requests.slice(0, WHY_MAX_REQUESTS).map((row) => (
                <li key={row.id}>
                  <button type="button" className="pp-link" onClick={() => onOpenRequest(row.id)}>
                    <RequestLabel method={row.entry.method} path={row.name.path} url={row.entry.url} />
                  </button>
                  <span className="np-aside">{row.measured === undefined ? '' : formatDuration(row.measured)}</span>
                </li>
              ))}
            </ul>
            {cause.requests.length > WHY_MAX_REQUESTS ? (
              <span className="np-aside">{STRINGS.more(cause.requests.length - WHY_MAX_REQUESTS)}</span>
            ) : null}
          </>
        ) : null}
        {cause.kind === 'page' ? (
          <>
            {STRINGS.page}
            {moment.frame ? null : <span className="np-aside">{STRINGS.attribution}</span>}
          </>
        ) : null}
        {cause.kind === 'none' ? (
          <>
            {STRINGS.taskIdle}
            {moment.frame ? null : <span className="np-aside">{STRINGS.attribution}</span>}
          </>
        ) : null}
      </dd>
    </dl>
  );
}
