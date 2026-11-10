import { use, type ReactNode } from 'react';

import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx';

import { formatDuration } from '../network/model.ts';
import { VERDICT_WORDS, type Vital, type VitalId } from './model.ts';
import { GROUP_LABELS, type GroupNote, groupNote, type Stat, type StatGroup, vitalStat } from './stats.ts';
import { HostSurfaceSlot } from '../../plugins/HostSurface.tsx';
import { PluginContexts } from '../../plugins/PluginUi.tsx';

export interface VitalPeer {
  id: string;
  name: string;
  colour: number;
  deltas: Partial<Record<VitalId, number>>;
}

/** Differences under this are one capture's noise, not a regression or a win. */
const SAME_WITHIN_MS = 20;

function deltaText(difference: number, name: string) {
  if (Math.abs(difference) < SAME_WITHIN_MS) return `Same as ${name}`;
  return `${difference > 0 ? '+' : '−'}${formatDuration(Math.abs(difference))} vs ${name}`;
}

function deltaTone(difference: number) {
  if (Math.abs(difference) < SAME_WITHIN_MS) return;
  return difference > 0 ? 'worse' : 'better';
}

/**
 * The recording's measurements as one grid of stats: Loading, Responsiveness, Smoothness. Each is a label, a number, and
 * a thin meter of its good, needs work and poor bands with a marker at the value; the rating word is in the tooltip and
 * read aloud. A stat with a moment behind it selects that moment; a paint seeks to when it happened; pairwise
 * differences show inline or as a larger comparison on demand.
 */
export function VitalsBar({
  vitals,
  peers,
  cadence = NO_STATS,
  onPick,
  children,
}: {
  vitals: readonly Vital[];
  peers: readonly VitalPeer[];
  /** The smoothness stats (frame rate, dropped frames, layout shift). */
  cadence?: readonly Stat[];
  onPick: (vital: Vital) => void;
  /** Controls at the bar's end. */
  children?: ReactNode;
}) {
  const viewer = use(PluginContexts)?.('');
  const context = viewer ? { replay: viewer.replay, seek: viewer.seek.bind(viewer) } : {};
  const items = [...vitals.map((vital) => ({ stat: vitalStat(vital), vital })), ...cadence.map((stat) => ({ stat, vital: undefined }))];
  const groups = GROUPS.map((group) => {
    const inGroup = items.filter((item) => item.stat.group === group);
    return {
      group,
      shown: inGroup.filter((item) => item.stat.value !== undefined),
      note: groupNote(
        group,
        inGroup.filter((item) => item.stat.value === undefined).map((item) => item.stat),
      ),
    };
  });
  const builtins = groups.flatMap(({ shown }, position) => {
    if (!shown.length) return [];
    return shown.map(({ stat, vital }, index) => ({
      id: `core:${stat.id}`,
      order: (position + 1) * 1000 + index * 10,
      render: () => (
        <>
          <StatTile
            stat={stat}
            start={index === 0}
            pickable={vital ? Boolean(vital.moment) || vital.at !== undefined : false}
            onPick={() => vital && onPick(vital)}
          >
            {vital && peers.length === 1 ? peers.map((peer) => <VitalDelta key={peer.id} vital={vital} peer={peer} />) : null}
          </StatTile>
          {vital && peers.length > 1 ? <VitalComparisons vital={vital} peers={peers} /> : null}
        </>
      ),
    }));
  });
  if (groups.every(({ shown }) => !shown.length))
    return (
      <div className="pp-vitals" data-testid="performance-vitals">
        <Tooltip>
          {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- why: the reason is in a tooltip, so keyboard users must reach it. */}
          <TooltipTrigger render={<p tabIndex={0} />} className="pp-stats-empty">
            No performance measurements were recorded
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span className="pp-stat-tip">{groups[0]?.note.reason ?? groups[0]?.note.text}</span>
          </TooltipContent>
        </Tooltip>
        {children}
      </div>
    );
  const footnote: GroupNote[] = groups.flatMap(({ group, shown, note }) => {
    if (!shown.length) return [note];
    const absent = items.filter((item) => item.stat.group === group && item.stat.value === undefined && item.stat.watched);
    return [...new Set(absent.map((item) => item.stat.absent))].flatMap((text) => (text ? [{ text }] : []));
  });
  return (
    <div className="pp-vitals" data-testid="performance-vitals">
      <ul aria-label="Vitals">
        <HostSurfaceSlot slot="performance.vitals" context={context} element="li" builtins={builtins} />
      </ul>
      {footnote.length ? <Footnote notes={footnote} /> : null}
      {children}
    </div>
  );
}

const NO_STATS: readonly Stat[] = [];
const GROUPS: readonly StatGroup[] = ['loading', 'responsiveness', 'smoothness'];

/** What is missing, as one quiet line; a note that knows its reason says it in a tooltip. */
function Footnote({ notes }: { notes: readonly GroupNote[] }) {
  return (
    <p className="pp-stats-footnote">
      {notes.map((note, index) => (
        <span key={note.text}>
          {index ? '. ' : ''}
          {note.reason ? (
            <Tooltip>
              <TooltipTrigger render={<span />} className="pp-footnote-reason">
                {note.text}
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <span className="pp-stat-tip">{note.reason}</span>
              </TooltipContent>
            </Tooltip>
          ) : (
            note.text
          )}
        </span>
      ))}
    </p>
  );
}

function StatTile({
  stat,
  start,
  pickable,
  onPick,
  children,
}: {
  stat: Stat;
  start: boolean;
  pickable: boolean;
  onPick: () => void;
  children?: ReactNode;
}) {
  const word = stat.verdict ? VERDICT_WORDS[stat.verdict] : undefined;
  const body = (
    <>
      <span className="pp-stat-group" aria-hidden="true">
        {start ? GROUP_LABELS[stat.group] : ''}
      </span>
      <span className="pp-vital-label">{stat.label}</span>
      <span className="pp-stat-value">
        {stat.value}
        {stat.unit ? <span className="pp-unit"> {stat.unit}</span> : null}
      </span>
      <StatMeter stat={stat} />
      {word ? (
        <span className="pp-stat-word" data-verdict={stat.verdict}>
          {word}
        </span>
      ) : null}
      {children}
    </>
  );
  const tip = [word && `${word}.`, stat.hint].filter(Boolean).join(' ');
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          pickable ? (
            <button type="button" onClick={onPick} />
          ) : (
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- why: a stat that cannot be picked is still read by keyboard, so its tooltip is reachable.
            <div tabIndex={0} />
          )
        }
        className="pp-stat pp-vital"
        data-group={stat.group}
        data-group-start={start || undefined}
        data-verdict={stat.verdict}
      >
        {body}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <span className="pp-stat-tip">{tip}</span>
      </TooltipContent>
    </Tooltip>
  );
}

function StatMeter({ stat }: { stat: Stat }) {
  const { meter } = stat;
  if (!meter) return null;
  return (
    <span className="pp-meter" aria-hidden="true">
      {meter.bands.map((band) => (
        <span
          key={band.verdict}
          className="pp-meter-band"
          data-verdict={band.verdict}
          data-active={band.verdict === stat.verdict || undefined}
          style={{ flexGrow: band.share }}
        />
      ))}
      <span className="pp-meter-mark" style={{ left: `${meter.at * 100}%` }} />
    </span>
  );
}

function VitalDelta({ vital, peer }: { vital: Vital; peer: VitalPeer }) {
  const difference = peer.deltas[vital.id];
  if (difference === undefined) return null;
  return (
    <span className="pp-delta" data-tone={deltaTone(difference)} data-tile={peer.colour}>
      <span className="ct-swatch" aria-hidden="true" />
      {deltaText(difference, peer.name)}
    </span>
  );
}

function VitalComparisons({ vital, peers }: { vital: Vital; peers: readonly VitalPeer[] }) {
  const measured = peers.filter((peer) => peer.deltas[vital.id] !== undefined);
  if (!measured.length || vital.value === undefined) return null;
  const currentValue = vital.value;
  return (
    <Popover>
      <PopoverTrigger
        className="pp-compare"
        aria-label={`Compare ${vitalStat(vital).label.toLowerCase()} with ${measured.length} ${measured.length === 1 ? 'recording' : 'recordings'}`}
      >
        {measured.length} other {measured.length === 1 ? 'recording' : 'recordings'}
      </PopoverTrigger>
      <PopoverContent className="pp-comparisons" align="start" aria-label={`${vitalStat(vital).label} comparison`}>
        <PopoverTitle className="text-xs" aria-label={`${vitalStat(vital).label} comparison`}>
          {vitalStat(vital).label}
        </PopoverTitle>
        <p>Current recording: {formatDuration(currentValue)}</p>
        <table>
          <thead>
            <tr>
              <th scope="col">Recording</th>
              <th scope="col">Value</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {measured.map((peer) => {
              const difference = -(peer.deltas[vital.id] ?? 0);
              return (
                <tr key={peer.id}>
                  <th scope="row" data-tile={peer.colour}>
                    <span className="ct-swatch" aria-hidden="true" />
                    {peer.name}
                  </th>
                  <td>{formatDuration(currentValue + difference)}</td>
                  <td className="pp-delta" data-tone={deltaTone(difference)}>
                    {Math.abs(difference) < SAME_WITHIN_MS
                      ? 'Same'
                      : `${difference > 0 ? '+' : '−'}${formatDuration(Math.abs(difference))}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </PopoverContent>
    </Popover>
  );
}
