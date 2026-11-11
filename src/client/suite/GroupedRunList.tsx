import { useQueryClient } from '@tanstack/react-query';
import type { KeyboardEvent, ReactNode } from 'react';

import { cssVars } from '../lib/css-vars.ts';
import { prefetchReplay } from '../queries.ts';
import { shortNames } from '../compare/tiles.ts';
import { formatMs, formatPercent, type groupRuns, type TargetSummary } from '../../shared/suite-groups.ts';
import type { ReviewSuiteIndexRun } from '../../shared/review-suite.ts';
import { playableReplayId } from './runs.ts';

type Run = ReviewSuiteIndexRun;
type Groups = ReturnType<typeof groupRuns<Run>>;

/** What the grouped list needs from the workspace: the selection, colours and how a run is shown. */
export interface GroupedListProps {
  groups: Groups;
  detailed: boolean;
  selected: string | undefined;
  colours: ReadonlyMap<string, number>;
  onSelect: (replayId: string | undefined) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** Renders an ungrouped run's row copy (the workspace's own row), so "Other runs" look like the flat list. */
  renderOtherRow: (run: Run, name: string) => ReactNode;
  statusOf: (run: Run) => string;
}

const samplesLabel = (count: number) => `${count} ${count === 1 ? 'sample' : 'samples'}`;

export function deltaTone(delta: number) {
  if (delta < 0) return 'good';
  return delta > 0 ? 'poor' : 'same';
}

const swatch = (colours: ReadonlyMap<string, number>, replayId: string) =>
  cssVars({ '--run-colour': `var(--tile-${colours.get(replayId)}, var(--text-tertiary))` });

/** A row that opens a recording, or sits disabled when the run has none. */
function RowButton({
  replayId,
  className,
  current,
  label,
  expanded,
  tabbable,
  colours,
  onOpen,
  onKeyDown,
  children,
}: {
  replayId: string | undefined;
  className: string;
  current: boolean;
  label: string;
  expanded?: boolean | undefined;
  tabbable: boolean;
  colours: ReadonlyMap<string, number>;
  onOpen: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  if (!replayId)
    return (
      <div className={className} aria-disabled="true" title={label}>
        {children}
      </div>
    );
  const prefetch = () => void prefetchReplay(queryClient, replayId);
  return (
    <button
      type="button"
      className={className}
      data-replay-id={replayId}
      style={swatch(colours, replayId)}
      aria-current={current ? 'page' : undefined}
      aria-expanded={expanded}
      aria-label={label}
      tabIndex={tabbable ? 0 : -1}
      onPointerEnter={prefetch}
      onFocus={prefetch}
      onClick={onOpen}
      onKeyDown={onKeyDown}
    >
      {children}
    </button>
  );
}

/** A group's header: its name, then the targets it compares with the baseline first and marked. */
export function GroupHeading({ name, targets }: { name: string; targets: ReadonlyArray<TargetSummary<Run>> }) {
  return (
    <h3 className="suite-group-head" data-testid="suite-group-head">
      <span className="suite-group-name">{name}</span>
      {targets.map((entry, index) => (
        <span key={entry.target}>
          {index > 0 ? 'vs ' : ''}
          {entry.target}
          {entry.baseline ? <span className="suite-baseline"> baseline</span> : null}
        </span>
      ))}
    </h3>
  );
}

function TargetCopy({ entry }: { entry: TargetSummary<Run> }) {
  const median = entry.median === undefined ? undefined : formatMs(entry.median);
  return (
    <>
      <span className="run-swatch" aria-hidden="true" />
      <span className="run-copy">
        <span className="run-label" title={entry.target}>
          {entry.target}
          {entry.baseline ? <span className="suite-baseline"> baseline</span> : null}
        </span>
        {entry.delta === undefined ? null : (
          <span className="target-delta" data-tone={deltaTone(entry.delta)} data-testid="target-delta">
            {formatPercent(entry.delta)}
          </span>
        )}
        <span className="run-meta" data-testid="target-summary">
          <span>{samplesLabel(entry.samples.length)}</span>
          {median ? (
            <span>
              {entry.measure ? `${entry.measure} · ` : ''}
              <strong>{median}</strong> {entry.samples.length > 1 ? 'median' : ''}
            </span>
          ) : null}
        </span>
      </span>
    </>
  );
}

function SampleRow({ run, index, target, props }: { run: Run; index: number; target: string; props: GroupedListProps }) {
  const playable = playableReplayId(run, props.detailed);
  const tone = props.statusOf(run);
  const time = run.measureMs === undefined ? undefined : formatMs(run.measureMs);
  const label = `${target} sample ${index + 1}${time ? `, ${time}` : ''}, ${tone}`;
  return (
    <div role="listitem">
      <RowButton
        replayId={playable}
        className="suite-run-item suite-sample"
        current={playable !== undefined && playable === props.selected}
        label={label}
        tabbable={playable !== undefined && playable === props.selected}
        colours={props.colours}
        onOpen={() => props.onSelect(playable)}
        onKeyDown={props.onKeyDown}
      >
        <span className="run-swatch" aria-hidden="true" />
        <span className="run-copy">
          <span className="run-label">Sample {index + 1}</span>
          {time ? <span className="run-duration">{time}</span> : null}
          {tone === 'passed' ? null : (
            <span className="run-meta">
              <span className={`run-status tone-${tone}`}>{playable ? tone : 'No recording'}</span>
            </span>
          )}
        </span>
      </RowButton>
    </div>
  );
}

function TargetRow({ group, entry, first, props }: { group: string; entry: TargetSummary<Run>; first: boolean; props: GroupedListProps }) {
  const ids = entry.samples.flatMap((run) => playableReplayId(run, props.detailed) ?? []);
  const open = props.selected !== undefined && ids.includes(props.selected);
  const single = entry.samples.length === 1;
  const median = entry.median === undefined ? '' : `, ${formatMs(entry.median)} median`;
  const label = `${group}, ${entry.target}${entry.baseline ? ', baseline' : ''}, ${samplesLabel(entry.samples.length)}${median}`;
  const firstId = ids[0];
  return (
    <div role="listitem" className="suite-target" data-open={open || undefined}>
      <RowButton
        replayId={firstId}
        className="suite-run-item"
        current={open && single}
        label={label}
        expanded={single ? undefined : open}
        tabbable={open || (props.selected === undefined && first)}
        colours={props.colours}
        onOpen={() => props.onSelect(single || !open ? firstId : undefined)}
        onKeyDown={props.onKeyDown}
      >
        <TargetCopy entry={entry} />
      </RowButton>
      {open && !single ? (
        <div role="list" aria-label={`${entry.target} samples`} className="suite-samples">
          {entry.samples.map((run, index) => (
            <SampleRow key={run.id} run={run} index={index} target={entry.target} props={props} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OtherRuns({ props }: { props: GroupedListProps }) {
  const names = shortNames(props.groups.other.map((run) => run.label));
  return (
    <div role="listitem" className="suite-group">
      <h3 className="suite-group-head" data-testid="suite-group-head">
        <span className="suite-group-name">Other runs</span>
      </h3>
      <div role="list" aria-label="Other runs">
        {props.groups.other.map((run, index) => {
          const playable = playableReplayId(run, props.detailed);
          const current = playable !== undefined && playable === props.selected;
          return (
            <div role="listitem" key={run.id}>
              <RowButton
                replayId={playable}
                className="suite-run-item"
                current={current}
                label={`Run ${String(run.sequence).padStart(2, '0')}: ${run.label}, ${props.statusOf(run)}`}
                tabbable={current}
                colours={props.colours}
                onOpen={() => props.onSelect(playable)}
                onKeyDown={props.onKeyDown}
              >
                {props.renderOtherRow(run, names[index] ?? run.label)}
              </RowButton>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A grouped suite's runs: per group one row per target (samples, median, change from the baseline) that opens to its samples. */
export function GroupedRunList(props: GroupedListProps) {
  return (
    <>
      {props.groups.groups.map((group) => (
        <div role="listitem" key={group.name} className="suite-group">
          <GroupHeading name={group.name} targets={group.targets} />
          <div role="list" aria-label={group.name}>
            {group.targets.map((entry, index) => (
              <TargetRow key={entry.target} group={group.name} entry={entry} first={index === 0} props={props} />
            ))}
          </div>
        </div>
      ))}
      {props.groups.other.length ? <OtherRuns props={props} /> : null}
    </>
  );
}
