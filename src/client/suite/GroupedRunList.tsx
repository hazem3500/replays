import { useQueryClient } from '@tanstack/react-query';
import type { KeyboardEvent, ReactNode } from 'react';

import { cssVars } from '../lib/css-vars.ts';
import { prefetchReplay } from '../queries.ts';
import { shortNames } from '../compare/tiles.ts';
import { formatMs, formatPercent, type groupRuns, type RunGroup, sectionCount, type TargetSummary } from '../../shared/suite-groups.ts';
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
  /** Renders a run's row copy (the workspace's own row), so sections and "Other runs" look like the flat list. */
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

/** How a row stands: the open run, a disclosure's state, and whether the row is the list's tab stop. */
interface RowState {
  current: boolean;
  tabbable: boolean;
  expanded?: boolean | undefined;
}

/** A row that opens a recording, or sits disabled when the run has none. */
function RowButton({
  replayId,
  className,
  label,
  state,
  onOpen,
  list,
  children,
}: {
  replayId: string | undefined;
  className: string;
  label: string;
  state: RowState;
  onOpen: () => void;
  list: GroupedListProps;
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
      style={swatch(list.colours, replayId)}
      aria-current={state.current ? 'page' : undefined}
      aria-expanded={state.expanded}
      aria-label={label}
      tabIndex={state.tabbable ? 0 : -1}
      onPointerEnter={prefetch}
      onFocus={prefetch}
      onClick={onOpen}
      onKeyDown={list.onKeyDown}
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
  const isSelected = playable !== undefined && playable === props.selected;
  const label = `${target} sample ${index + 1}${time ? `, ${time}` : ''}, ${tone}`;
  return (
    <div role="listitem">
      <RowButton
        replayId={playable}
        className="suite-run-item suite-sample"
        label={label}
        state={{ current: isSelected, tabbable: isSelected }}
        onOpen={() => props.onSelect(playable)}
        list={props}
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
        label={label}
        state={{ current: open && single, expanded: single ? undefined : open, tabbable: open || (props.selected === undefined && first) }}
        onOpen={() => props.onSelect(single || !open ? firstId : undefined)}
        list={props}
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

/** Runs listed under a heading as plain rows: a group that only sections its runs, or the suite's ungrouped runs. */
function RunSection({ name, runs, counted, props }: { name: string; runs: Run[]; counted: boolean; props: GroupedListProps }) {
  const names = shortNames(runs.map((run) => run.label));
  return (
    <div role="listitem" className="suite-group">
      <h3 className="suite-group-head" data-testid="suite-group-head">
        <span className="suite-group-name">{name}</span>
        {counted ? <span data-testid="suite-group-count">{sectionCount(runs)}</span> : null}
      </h3>
      <div role="list" aria-label={name}>
        {runs.map((run, index) => {
          const playable = playableReplayId(run, props.detailed);
          const current = playable !== undefined && playable === props.selected;
          return (
            <div role="listitem" key={run.id}>
              <RowButton
                replayId={playable}
                className="suite-run-item"
                label={`Run ${String(run.sequence).padStart(2, '0')}: ${run.label}, ${props.statusOf(run)}`}
                state={{ current, tabbable: current }}
                onOpen={() => props.onSelect(playable)}
                list={props}
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

/** A group whose runs compare: its heading with the targets, then one row per target. */
function ComparisonGroup({ group, props }: { group: RunGroup<Run>; props: GroupedListProps }) {
  return (
    <div role="listitem" className="suite-group">
      <GroupHeading name={group.name} targets={group.targets} />
      <div role="list" aria-label={group.name}>
        {group.targets.map((entry, index) => (
          <TargetRow key={entry.target} group={group.name} entry={entry} first={index === 0} props={props} />
        ))}
      </div>
    </div>
  );
}

/**
 * A grouped suite's runs. A comparison group has one row per target (samples, median, change from the baseline) that
 * opens to its samples; any other group is a section, its name and count over its runs' own rows.
 */
export function GroupedRunList(props: GroupedListProps) {
  return (
    <>
      {props.groups.groups.map((group) =>
        group.comparison ? (
          <ComparisonGroup key={group.name} group={group} props={props} />
        ) : (
          <RunSection key={group.name} name={group.name} runs={group.runs} counted props={props} />
        ),
      )}
      {props.groups.other.length ? <RunSection name="Other runs" runs={props.groups.other} counted={false} props={props} /> : null}
    </>
  );
}
