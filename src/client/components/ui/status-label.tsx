import type { ReactNode } from 'react';

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

/**
 * A status as a coloured dot and a word — never a bordered pill. The badge rule: at most one bordered pill in a row;
 * statuses use this, counts use the count badge, and secondary facts are quiet text. `strong` (failed, flaky) colours
 * the word too, so problems read before passes.
 */
export function StatusLabel({
  tone,
  strong = false,
  children,
  'data-testid': testId,
}: {
  tone: StatusTone;
  strong?: boolean;
  children: ReactNode;
  'data-testid'?: string;
}) {
  return (
    <span className="status-label" data-tone={tone} data-strong={strong || undefined} data-testid={testId}>
      <span className="status-label-dot" aria-hidden="true" />
      <span className="status-label-word">{children}</span>
    </span>
  );
}
