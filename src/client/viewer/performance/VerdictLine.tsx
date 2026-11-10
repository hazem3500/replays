import { Button } from '@/components/ui/button.tsx';

import type { PerformanceVerdict, VerdictJump } from './verdict.ts';

/** The recording's answer to "was this slow, and why" in one short line, with a quiet button to the moment. */
export function VerdictLine({
  verdict,
  onJump,
  inline,
}: {
  verdict: PerformanceVerdict;
  onJump: (jump: VerdictJump) => void;
  /** On the timeline's axis row rather than its own row. */
  inline?: boolean;
}) {
  const { jump } = verdict;
  return (
    <div className="pp-lead" data-testid="performance-verdict" data-tone={verdict.tone} data-inline={inline || undefined}>
      <span className="pp-lead-dot" aria-hidden="true" />
      <p>{verdict.headline}</p>
      {jump ? (
        <Button variant="ghost" size="sm" className="pp-lead-jump" onClick={() => onJump(jump)}>
          {jump.label}
        </Button>
      ) : null}
    </div>
  );
}
