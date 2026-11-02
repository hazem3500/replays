import type { ReactNode } from 'react';

import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover.tsx';

import { formatDuration } from '../network/model.ts';
import { VERDICT_WORDS, type Vital, type VitalId } from './model.ts';

const LABELS: Readonly<Record<VitalId, string>> = {
  fcp: 'First paint',
  lcp: 'Largest paint',
  interaction: 'Slowest interaction',
  task: 'Longest task',
  tbt: 'Blocking time',
};

const HINTS: Readonly<Record<VitalId, string>> = {
  fcp: 'First contentful paint: when anything first appeared. Good under 1.8 s, poor over 3 s.',
  lcp: 'Largest contentful paint: the latest candidate the browser reported. Good under 2.5 s, poor over 4 s.',
  interaction: 'The slowest response to a click, key or input. Good under 200 ms, poor over 500 ms.',
  task: 'The longest stretch the main thread could not respond. Good under 100 ms, poor over 250 ms.',
  tbt: 'Every long task’s time past 50 ms, summed. Good under 200 ms, poor over 600 ms.',
};

const MISSING = { 'not-captured': 'Not captured', none: 'None' } as const;

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
 * Selected recording's measurements, with pairwise differences inline or larger comparisons available on demand.
 * A vital with a moment behind it selects that moment; a paint seeks to when it happened.
 */
export function VitalsBar({
  vitals,
  peers,
  onPick,
  children,
}: {
  vitals: readonly Vital[];
  peers: readonly VitalPeer[];
  onPick: (vital: Vital) => void;
  /** Controls at the bar's end (the list order). */
  children?: ReactNode;
}) {
  return (
    <div className="pp-vitals" data-testid="performance-vitals">
      <ul aria-label="Vitals">
        {vitals.map((vital) => (
          <li key={vital.id}>
            <button
              type="button"
              className="pp-vital"
              title={HINTS[vital.id]}
              disabled={!vital.moment && vital.at === undefined}
              onClick={() => onPick(vital)}
            >
              <span className="pp-vital-label">{LABELS[vital.id]}</span>
              <VitalValue vital={vital} />
              {peers.length === 1 ? peers.map((peer) => <VitalDelta key={peer.id} vital={vital} peer={peer} />) : null}
            </button>
            {peers.length > 1 ? <VitalComparisons vital={vital} peers={peers} /> : null}
          </li>
        ))}
      </ul>
      {children}
    </div>
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
  if (!measured.length) return null;
  return (
    <Popover>
      <PopoverTrigger
        className="pp-compare"
        aria-label={`Compare ${LABELS[vital.id].toLowerCase()} with ${measured.length} ${measured.length === 1 ? 'recording' : 'recordings'}`}
      >
        Compare {measured.length}
      </PopoverTrigger>
      <PopoverContent className="pp-comparisons" align="start">
        <PopoverTitle>{LABELS[vital.id]} comparison</PopoverTitle>
        <p>Selected recording compared with:</p>
        <ul>
          {measured.map((peer) => (
            <li key={peer.id}>
              <VitalDelta vital={vital} peer={peer} />
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function VitalValue({ vital }: { vital: Vital }) {
  if (vital.value === undefined || !vital.verdict)
    return <span className="pp-vital-value pp-missing">{MISSING[vital.missing ?? 'not-captured']}</span>;
  return (
    <span className="pp-vital-value">
      {formatDuration(vital.value)}
      <span className="pp-verdict" data-verdict={vital.verdict}>
        <span className="pp-dot" aria-hidden="true" />
        {VERDICT_WORDS[vital.verdict]}
      </span>
    </span>
  );
}
