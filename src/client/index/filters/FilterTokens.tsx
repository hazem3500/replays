import { XIcon } from 'lucide-react';
import { type MouseEvent, useRef } from 'react';

import { useGlide } from '../../hooks/use-glide.ts';
import { usePresence } from '../../hooks/use-presence.ts';
import { type FilterToken, filterStrings } from './model.ts';

const MAX_TOKENS = 3;
/** Fallback only: tokens leave on their own `transitionend`. */
const TOKEN_EXIT_FALLBACK_MS = 600;

/** The removed token takes the keyboard position with it: to a neighbour, else to the Filter button. */
function handOffFocus(event: MouseEvent<HTMLButtonElement>) {
  const token = event.currentTarget.closest('.filter-token');
  const neighbour =
    token?.nextElementSibling?.querySelector<HTMLElement>('button') ??
    token?.previousElementSibling?.querySelector<HTMLElement>('button') ??
    token?.closest('.scope-bar-end')?.querySelector<HTMLElement>('.scope-button');
  neighbour?.focus();
}

function Token({
  token,
  exiting,
  onOpen,
  onExited,
}: {
  token: FilterToken;
  exiting: boolean;
  onOpen: (token: FilterToken) => void;
  onExited: (id: string) => void;
}) {
  return (
    <span
      className="filter-token"
      data-token-id={token.id}
      data-slot-item={token.id}
      data-exiting={exiting || undefined}
      inert={exiting || undefined}
      onTransitionEnd={(event) => {
        if (exiting && event.target === event.currentTarget && event.propertyName === 'opacity') onExited(token.id);
      }}
    >
      <button type="button" className="filter-token-open" aria-label={filterStrings.editToken(token.name)} onClick={() => onOpen(token)}>
        {token.field ? <span className="filter-token-field">{token.field}</span> : null}
        <span className="filter-token-value">{token.value}</span>
      </button>
      <button
        type="button"
        className="filter-token-remove"
        aria-label={filterStrings.removeToken(token.name)}
        onClick={(event) => {
          handOffFocus(event);
          token.remove();
        }}
      >
        <XIcon aria-hidden="true" />
      </button>
    </span>
  );
}

/** Desktop: the active filters left of the Filter button, at most three, then "+N" and Clear. */
export function FilterTokens({
  tokens,
  onOpen,
  onClear,
}: {
  tokens: readonly FilterToken[];
  /** A token opens the menu at its field; "+N" (no token) opens the list. */
  onOpen: (token?: FilterToken) => void;
  onClear: () => void;
}) {
  const shown = tokens.slice(0, MAX_TOKENS);
  const hidden = tokens.length - shown.length;
  const { rendered, settle } = usePresence(shown, TOKEN_EXIT_FALLBACK_MS);
  const group = useRef<HTMLDivElement>(null);
  useGlide(group, '[data-token-id]:not([data-exiting])', 'data-token-id');
  if (rendered.length === 0) return null;
  return (
    <div ref={group} className="filter-tokens" role="group" aria-label={filterStrings.activeFilters} data-slot="index.chips">
      {rendered.map(({ item, exiting }) => (
        <Token key={item.id} token={item} exiting={exiting} onOpen={onOpen} onExited={settle} />
      ))}
      {hidden > 0 ? (
        <button
          type="button"
          className="filter-token filter-token-more"
          data-token-id="more"
          aria-label={filterStrings.moreLabel(hidden)}
          onClick={() => onOpen()}
        >
          {filterStrings.more(hidden)}
        </button>
      ) : null}
      {tokens.length > 1 ? (
        <button type="button" className="filter-tokens-clear" data-token-id="clear" onClick={onClear}>
          {filterStrings.clear}
        </button>
      ) : null}
    </div>
  );
}
