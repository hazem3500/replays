import { use, type ReactNode } from 'react';

import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx';

import { formatDuration } from '../network/model.ts';
import { VERDICT_WORDS, type Vital, type VitalId } from './model.ts';
import { GROUP_LABELS, type Stat, type StatGroup, vitalStat } from './stats.ts';
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
  const items = [
    ...vitals.map((vital) => ({ stat: vitalStat(vital), vital })),
    ...cadence.map((stat) => ({ stat, vital: undefined })),
  ];
  const started = new Set<StatGroup>();
  const builtins = items.map(({ stat, vital }, index) => {
    const start = !started.has(stat.group);
    started.add(stat.group);
    return {
      id: `core:${stat.id}`,
      order: (index + 1) * 100,
      render: () => (
        <>
          <StatTile
            stat={stat}
            start={start}
            pickable={vital ? Boolean(vital.moment) || vital.at !== undefined : false}
            onPick={() => vital && onPick(vital)}
          >
            {vital && peers.length === 1 ? peers.map((peer) => <VitalDelta key={peer.id} vital={vital} peer={peer} />) : null}
          </StatTile>
          {vital && peers.length > 1 ? <VitalComparisons vital={vital} peers={peers} /> : null}
        </>
      ),
    };
  });
  return (
    <div className="pp-vitals" data-testid="performance-vitals">
      <ul aria-label="Vitals">
        <HostSurfaceSlot slot="performance.vitals" context={context} element="li" builtins={builtins} />
      </ul>
      {children}
    </div>
  );
}

const NO_STATS: readonly Stat[] = [];

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
      {stat.value === undefined ? (
        <span className="pp-stat-value pp-missing">
          <span aria-hidden="true">—</span>
          <span className="visually-hidden">{stat.missing}</span>
        </span>
      ) : (
        <span className="pp-stat-value">
          {stat.value}
          {stat.unit ? <span className="pp-unit"> {stat.unit}</span> : null}
        </span>
      )}
      <StatMeter stat={stat} />
      {word ? <span className="pp-stat-word" data-verdict={stat.verdict}>{word}</span> : null}
      {children}
    </>
  );
  const tip = [word && `${word}.`, stat.missing, stat.hint].filter(Boolean).join(' ');
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
  if (!meter) return <span className="pp-meter" data-empty="" aria-hidden="true" />;
  return (
    <span className="pp-meter" aria-hidden="true">
      {meter.bands.map((band) => (
        <span key={band.verdict} className="pp-meter-band" data-verdict={band.verdict} data-active={band.verdict === stat.verdict || undefined} style={{ flexGrow: band.share }} />
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
