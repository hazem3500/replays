import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button.tsx';

import type { PerformanceVerdict, VerdictJump } from './verdict.ts';

/** The recording's answer to "was this slow, and why" in one short line, with a quiet button to the moment. */
export function VerdictLine({
  verdict,
  onJump,
  children,
}: {
  verdict: PerformanceVerdict;
  onJump: (jump: VerdictJump) => void;
  /** Icon controls at the row's end, after the jump button. */
  children?: ReactNode;
}) {
  const { jump } = verdict;
  return (
    <div className="pp-lead" data-testid="performance-verdict" data-tone={verdict.tone}>
      <span className="pp-lead-dot" aria-hidden="true" />
      <p>{verdict.headline}</p>
      {jump ? (
        <Button variant="ghost" size="sm" className="pp-lead-jump" onClick={() => onJump(jump)}>
          {jump.label}
        </Button>
      ) : null}
      {children}
    </div>
  );
}
