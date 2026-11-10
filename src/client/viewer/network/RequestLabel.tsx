import { type ReactNode, useRef } from 'react';

import { useElementWidth } from '../../hooks/use-element-width.ts';
import { charBudget, shortenPath } from './request-label.ts';

/** The glyph width of the 12 px monospace label, with a little slack. */
const CHAR_PX = 7.4;
const METHOD_GAP = 1;

/** `:id` and `…` are muted: they are placeholders, not part of the endpoint's name. */
function muted(text: string): ReactNode[] {
  return text.split(/(:id|…)/).map((part, index) =>
    part === ':id' || part === '…' ? (
      <span key={index} className="rl-muted">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/**
 * A request as "GET /api/…/workspaces/:id/search" in the room it has: no origin or query, ids as `:id`, the middle cut
 * when the path would not fit. The full URL is the tooltip. `method` is given when the label shows it itself.
 */
export function RequestLabel({ method, path, url, showMethod = true }: { method: string; path: string; url: string; showMethod?: boolean }) {
  const box = useRef<HTMLSpanElement>(null);
  const width = useElementWidth(box, 0);
  const own = showMethod ? method.length + METHOD_GAP : 0;
  const budget = charBudget(width, CHAR_PX);
  const shown = shortenPath(path, budget === undefined ? undefined : Math.max(8, budget - own));
  return (
    <span ref={box} className="rl" title={url} data-testid="request-label">
      {showMethod ? <span className="rl-method">{method} </span> : null}
      <span className="rl-path">{muted(shown)}</span>
    </span>
  );
}
