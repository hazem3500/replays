import type { CSSProperties } from 'react';

import type { Budget, Verdict } from '../../../shared/diagnostics/budgets.ts';

const STRINGS = {
  label: (value: number, [good, poor]: Budget) => `${Math.round(value)} ms; good at ${good} ms or less, poor over ${poor} ms`,
};

/**
 * A bullet graph: the track runs from 0 to twice the Poor line (or the value, when longer), ticks mark Good and Poor,
 * and the bar reaches the value in its verdict's colour.
 */
export function BudgetBar({
  value,
  budget,
  verdict,
  size = 'row',
}: {
  value: number;
  budget: Budget;
  verdict: Verdict;
  size?: 'row' | 'large';
}) {
  const max = Math.max(budget[1] * 2, value);
  const percent = (ms: number) => `${(Math.min(ms, max) / max) * 100}%`;
  return (
    <span
      className="budget-bar"
      data-size={size}
      data-verdict={verdict}
      role="img"
      aria-label={STRINGS.label(value, budget)}
      style={
        { '--budget-value': percent(value), '--budget-good': percent(budget[0]), '--budget-poor': percent(budget[1]) } as CSSProperties
      }
    >
      <span className="budget-bar-fill" />
      <span className="budget-bar-mark" data-mark="good" />
      <span className="budget-bar-mark" data-mark="poor" />
    </span>
  );
}
