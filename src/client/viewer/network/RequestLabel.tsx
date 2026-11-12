import { type ReactNode, use, useRef } from 'react';

import { useElementWidth } from '../../hooks/use-element-width.ts';
import { LabelSearch } from './label-search.ts';
import { charBudget, markWords, shortenPath } from './request-label.ts';

/** The glyph width of the 12 px monospace label, with a little slack. */
const CHAR_PX = 7.4;
const METHOD_GAP = 1;

/** The stretches of `text` that match the search, marked. */
function marked(text: string, words: readonly string[], at: number): ReactNode[] {
  let offset = at;
  return markWords(text, words).map((part) => {
    const key = offset;
    offset += part.text.length;
    return part.hit ? (
      <mark key={key} className="rl-hit">
        {part.text}
      </mark>
    ) : (
      part.text
    );
  });
}

/** `:id` and `…` are muted: they are placeholders, not part of the endpoint's name. The rest marks search matches. */
function muted(text: string, words: readonly string[]): ReactNode[] {
  let offset = 0;
  return text.split(/(:id|…)/).flatMap((part) => {
    const key = offset;
    offset += part.length;
    return part === ':id' || part === '…' ? (
      <span key={key} className="rl-muted">
        {part}
      </span>
    ) : (
      marked(part, words, key)
    );
  });
}

/** Plain text (a host) with the Network search's matches marked. */
export function SearchMarked({ text }: { text: string }) {
  return marked(text, use(LabelSearch), 0);
}

/**
 * A request as "GET /api/…/workspaces/:id/search" in the room it has: no origin or query, ids as `:id`, the middle cut
 * when the path would not fit, never through a Network search match (it is marked). The full URL is the tooltip. `method` is given when the label shows it itself.
 */
export function RequestLabel({
  method,
  path,
  url,
  showMethod = true,
}: {
  method: string;
  path: string;
  url: string;
  showMethod?: boolean;
}) {
  const words = use(LabelSearch);
  const box = useRef<HTMLSpanElement>(null);
  const width = useElementWidth(box, 0);
  const own = showMethod ? method.length + METHOD_GAP : 0;
  const budget = charBudget(width, CHAR_PX);
  const shown = shortenPath(path, budget === undefined ? undefined : Math.max(8, budget - own), words);
  return (
    <span ref={box} className="rl" title={url} data-testid="request-label">
      {showMethod ? <span className="rl-method">{method} </span> : null}
      <span className="rl-path">{muted(shown, words)}</span>
    </span>
  );
}
