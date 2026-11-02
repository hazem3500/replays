import { useState, type KeyboardEvent } from 'react';

import { EmptyState } from '@/components/ui/empty-state.tsx';
import { detectIssues, groupInteractions, ms } from '../../../shared/diagnostics/detect.ts';
import { headlineParts } from '../../../shared/diagnostics/headline.ts';
import type { EvidenceRef, Issue, IssueLayer } from '../../../shared/diagnostics/types.ts';
import type { EditTimeline } from '../../../shared/edits.ts';
import { formatClock, hasNoResponse, isFailedRequest, type ReplayBundle } from '../../../shared/replay.ts';
import { useMediaQuery } from '../../media.ts';
import { usePlayer } from '../../player.ts';
import { evidenceAt, evidenceWindow, laneData } from './evidence.ts';
import { IssueEvidence, LayerChip } from './IssueEvidence.tsx';
import './issues.css';

const LAYERS: readonly IssueLayer[] = ['frontend', 'backend', 'network'];
const PHONE_QUERY = '(max-width: 600px)';

const STRINGS = {
  region: 'Issues',
  layers: 'Problems by layer',
  fine: 'fine',
  linked: (count: number) => `${count} linked ${count === 1 ? 'event' : 'events'}`,
  severity: { failure: 'Failure', poor: 'Poor', 'needs-improvement': 'Needs work' },
  requests: (ok: number, total: number) => `${ok} of ${total} requests OK`,
  median: (value: number) => `median ${ms(value)}`,
  paint: (value: number) => `first paint ${ms(value)}`,
  quick: (count: number) => `${count} ${count === 1 ? 'interaction' : 'interactions'} responded in 200 ms or less`,
  noTiming: 'no performance timing captured',
  humanTitle: 'Nothing to diagnose',
  humanBody: 'This recording was imported from rrweb, so console, network and performance weren’t captured.',
  noneTitle: 'No problems found',
};

function median(values: readonly number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** "Everything else": what went fine, so a short list of problems doesn't read as the whole story. */
function healthLine(bundle: ReplayBundle) {
  const ok = bundle.network.filter((entry) => !isFailedRequest(entry) && !hasNoResponse(entry));
  const fcp = bundle.performance?.entries.find((entry) => entry.kind === 'first-contentful-paint');
  const quick = groupInteractions((bundle.performance?.entries ?? []).map((entry, index) => ({ entry, index }))).filter(
    (interaction) => interaction.value <= 200,
  ).length;
  return [
    bundle.network.length ? STRINGS.requests(ok.length, bundle.network.length) : undefined,
    ok.length ? STRINGS.median(median(ok.map((entry) => entry.duration))) : undefined,
    fcp ? STRINGS.paint(fcp.value) : undefined,
    quick ? STRINGS.quick(quick) : undefined,
    bundle.performance?.entries.length ? undefined : STRINGS.noTiming,
  ]
    .filter(Boolean)
    .join(' · ');
}

export interface IssuesPanelProps {
  /** Captured data; times move to the player's clock through `timeline`. */
  sourceBundle: ReplayBundle;
  timeline?: EditTimeline | undefined;
  human: boolean;
  /** Select the evidence row in its drill-down (Network, Performance, Console); steps just seek. */
  onOpen: (ref: EvidenceRef) => void;
}

/** The default Diagnostics view: the headline, then ranked issues with their chain, layer and ±1 s evidence. */
export function IssuesPanel({ sourceBundle, timeline, human, onOpen }: IssuesPanelProps) {
  const player = usePlayer();
  const phone = useMediaQuery(PHONE_QUERY);
  const issues = detectIssues(sourceBundle, timeline);
  const data = laneData(sourceBundle, timeline);
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  // why: desktop always shows one case; phones open and close cards.
  const selected = issues.find((issue) => issue.id === chosen) ?? (phone ? undefined : issues[0]);
  const parts = headlineParts(issues);
  const counts = LAYERS.map((layer) => [layer, issues.filter((issue) => issue.layer === layer).length] as const);
  // why: opening evidence moves the replay to it, so the drill-down shows the row as "now", not upcoming.
  const open = (ref: EvidenceRef) => {
    const at = evidenceAt(data, ref);
    if (at !== undefined) player.seek(at);
    if (ref.kind !== 'step') onOpen(ref);
  };
  const evidence = (issue: Issue, heading: boolean) => (
    <IssueEvidence
      issue={issue}
      bundle={sourceBundle}
      data={data}
      window={evidenceWindow(issue, player.duration)}
      heading={heading}
      onSeek={player.seek}
      onOpen={open}
    />
  );
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1 : undefined;
    if (next === undefined || !issues[next]) return;
    event.preventDefault();
    event.stopPropagation();
    setChosen(issues[next].id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('.issue-card')[next]?.focus();
  };

  if (human) return <EmptyState variant="compact" icon="none" title={STRINGS.humanTitle} body={STRINGS.humanBody} testId="issues-empty" />;

  return (
    <section className="issues-panel" aria-label={STRINGS.region} data-slot="inspector.issues" data-testid="issues-panel">
      <div className="issues-list">
        <p className="issues-headline" data-testid="issues-headline">
          {parts.map((part, index) => (part.strong ? <strong key={index}>{part.text}</strong> : <span key={index}>{part.text}</span>))}
        </p>
        {issues.length ? (
          <ul className="issues-layers" aria-label={STRINGS.layers}>
            {counts.map(([layer, count]) => (
              <li key={layer} data-clear={!count || undefined}>
                <LayerChip layer={layer} />
                <span>{count || STRINGS.fine}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {issues.map((issue, index) => (
          <div key={issue.id} className="issue-item">
            <button
              type="button"
              className="issue-card"
              aria-expanded={phone ? selected?.id === issue.id : undefined}
              aria-current={!phone && selected?.id === issue.id ? 'true' : undefined}
              data-severity={issue.severity}
              onClick={() => setChosen(phone && chosen === issue.id ? '' : issue.id)}
              onKeyDown={(event) => move(event, index)}
            >
              <span className="issue-severity" data-severity={issue.severity} role="img" aria-label={STRINGS.severity[issue.severity]} />
              <span className="issue-card-main">
                <span className="issue-card-title">{issue.title}</span>
                <span className="issue-card-meta">
                  <LayerChip layer={issue.layer} />
                  <span className="issue-card-time">{formatClock(issue.at)}</span>
                  <span>· {STRINGS.linked(issue.chain.length - 1)}</span>
                </span>
              </span>
            </button>
            {phone && selected?.id === issue.id ? evidence(issue, false) : null}
          </div>
        ))}
        {issues.length === 0 ? (
          <EmptyState variant="compact" icon="sparkles" title={STRINGS.noneTitle} body={healthLine(sourceBundle)} testId="issues-empty" />
        ) : (
          <p className="issues-fine">
            <span className="issue-severity" data-severity="good" aria-hidden="true" />
            {healthLine(sourceBundle)}
          </p>
        )}
      </div>
      {!phone && selected ? <div className="issues-case">{evidence(selected, true)}</div> : null}
      {!phone && !selected && issues.length === 0 ? <div className="issues-case" aria-hidden="true" /> : null}
    </section>
  );
}
