import type { ReactNode } from 'react';

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
  letter: string;
  deltas: Partial<Record<VitalId, number>>;
}

/** Differences under this are one capture's noise, not a regression or a win. */
const SAME_WITHIN_MS = 20;

function deltaText(difference: number, letter: string) {
  if (Math.abs(difference) < SAME_WITHIN_MS) return `Same as ${letter}`;
  return `${difference > 0 ? '+' : '−'}${formatDuration(Math.abs(difference))} vs ${letter}`;
}

function deltaTone(difference: number) {
  if (Math.abs(difference) < SAME_WITHIN_MS) return undefined;
  return difference > 0 ? 'worse' : 'better';
}

/**
 * One row of verdicts: each vital's value, a verdict word (never colour alone) and, when comparing, how far it is from
 * each other recording. A vital with a moment behind it selects that moment; a paint seeks to when it happened.
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
              {peers.map((peer) => {
                const difference = peer.deltas[vital.id];
                return difference === undefined ? null : (
                  <span key={peer.id} className="pp-delta" data-tone={deltaTone(difference)}>
                    {deltaText(difference, peer.letter)}
                  </span>
                );
              })}
            </button>
          </li>
        ))}
      </ul>
      {children}
    </div>
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
