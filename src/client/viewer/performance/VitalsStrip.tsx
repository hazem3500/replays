import { ChevronDownIcon, XIcon } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx';

import { VERDICT_WORDS } from './model.ts';
import { setDetailsOpen } from './details-pref.ts';
import type { Stat } from './stats.ts';

/** One stat in the compact strip: its label, value and a rating dot; the tooltip carries the rating and its thresholds. */
export function StripStat({ stat, onPick, pressed }: { stat: Stat; onPick?: (() => void) | undefined; pressed?: boolean | undefined }) {
  const word = stat.verdict ? VERDICT_WORDS[stat.verdict] : undefined;
  const tip = [word && `${word}.`, stat.hint].filter(Boolean).join(' ');
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          onPick ? (
            // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- why: the trigger supplies the label, value and rating as its children.
            <button type="button" onClick={onPick} aria-pressed={pressed} />
          ) : (
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- why: a stat that cannot be picked is still read by keyboard, so its tooltip is reachable.
            <div tabIndex={0} />
          )
        }
        className="pp-chip pp-vital"
        data-group={stat.group}
        data-verdict={stat.verdict}
      >
        <span className="pp-chip-label">{stat.label}</span>
        <span className="pp-chip-value">
          {stat.value}
          {stat.unit ? <span className="pp-unit"> {stat.unit}</span> : null}
        </span>
        {stat.verdict ? <span className="pp-dot" data-verdict={stat.verdict} aria-hidden="true" /> : null}
        {word ? (
          <span className="pp-stat-word" data-verdict={stat.verdict}>
            {word}
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <span className="pp-stat-tip">{tip}</span>
      </TooltipContent>
    </Tooltip>
  );
}

/** Switches between the compact strip and the full grouped grid; the choice is remembered. */
export function DetailsToggle({ open }: { open: boolean }) {
  return (
    <button type="button" className="pp-details-toggle" aria-expanded={open} onClick={() => setDetailsOpen(!open)}>
      Details
      <ChevronDownIcon aria-hidden="true" />
    </button>
  );
}

/** What the stats are scoped to (a time range, the blocking tasks), each with a way to clear it. */
export function ScopeChips({ scopes }: { scopes: readonly { text: string; label: string; onClear: () => void }[] }) {
  if (!scopes.length) return null;
  return (
    <span className="pp-scopes">
      {scopes.map((scope) => (
        <span key={scope.text} className="pp-scope">
          {scope.text}
          <button type="button" onClick={scope.onClear}>
            <XIcon aria-hidden="true" />
            <span className="sr-only">{scope.label}</span>
          </button>
        </span>
      ))}
    </span>
  );
}
