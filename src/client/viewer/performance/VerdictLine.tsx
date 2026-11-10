import { Fragment } from 'react';

import type { PerformanceVerdict, VerdictPart } from './verdict.ts';

/**
 * The recording's answer to "was this slow, where, and why" in one sentence. A phrase that names a moment is a link:
 * it seeks there and, for an interaction or task, opens it in the table.
 */
export function VerdictLine({ verdict, onPick }: { verdict: PerformanceVerdict; onPick: (part: VerdictPart) => void }) {
  return (
    <p className="pp-lead" data-testid="performance-verdict" data-tone={verdict.tone}>
      <span className="pp-lead-dot" aria-hidden="true" />
      <span>
        {verdict.parts.map((sentence, index) => (
          <Fragment key={sentence.map((part) => part.text).join('')}>
            {index > 0 ? ' ' : null}
            {sentence.map((part) =>
              part.at === undefined ? (
                part.text
              ) : (
                <button key={part.text} type="button" className="pp-lead-link" onClick={() => onPick(part)}>
                  {part.text}
                </button>
              ),
            )}
            .
          </Fragment>
        ))}
      </span>
    </p>
  );
}
