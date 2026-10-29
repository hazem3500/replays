import { LayersIcon } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { ProductMark } from '@/components/brand-mark.tsx';
import { Hint } from '@/components/icon-button.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { useSlidingPill } from '@/components/sliding-highlight.tsx';

import type { ProfileInfo } from '../../shared/profiles.ts';

import { productLogo, productName } from '../config.ts';
import { navigate } from '../routing/navigate.ts';
import { formatRelative } from '../format.ts';
import { useHydrated } from '../hooks/use-hydrated.ts';
import { INDEX_SEARCH_ALT_KEY, indexSearchShortcut } from '../shortcuts.ts';
import { replayHref, suiteHref } from '../routing/links.ts';
import { entryTime, type FeedEntry, suitePosterRun } from './Feed.tsx';
import { createMarkMotion, createStreak, crossfadeTitle } from './mark-burst.ts';
import { Poster } from './Poster.tsx';
import { sourceText } from './SourceLine.tsx';

/*
 * The index's two quiet header rows (sticky as one block): row 1 is identity (mark, product name h1) with a
 * compact command search (⌘K, Ctrl+K or / from anywhere; quick results) and the actions;
 * row 2 is scope: the result count, then Filter, sort and layout on the right.
 */

/**
 * The mark as the "Replays home" button: scrolls the index to the top, with a short brand moment (the built-in mark
 * only): each click scrubs the mark one segment forward (it drains back 1.5 s after the last); the fifth rapid click
 * lets the playhead backspace the product name and type it back in (mark-burst.ts), then a cooldown.
 */
export function MarkButton() {
  const logo = productLogo();
  const button = useRef<HTMLButtonElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const motion = useRef<ReturnType<typeof createMarkMotion>>(undefined);
  const streak = useRef(createStreak());
  useEffect(() => {
    if (!svg.current) return;
    const mark = createMarkMotion(svg.current);
    motion.current = mark;
    return () => {
      mark.dispose();
      motion.current = undefined;
    };
  }, []);
  const onClick = () => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    // Only the built-in mark has a brand moment.
    if (logo) return;
    const step = streak.current.click();
    const title = button.current?.parentElement?.querySelector<HTMLElement>('.index-title');
    if (reduced) {
      // why: reduced motion keeps the scrub as a state change (segments fill, no movement); the burst only
      // crossfades the word.
      if (!step.burst) motion.current?.step(true);
      else if (title) crossfadeTitle(title);
      return;
    }
    if (step.burst) void motion.current?.burst(title);
    else motion.current?.step();
  };
  return (
    <button ref={button} type="button" className="mark-button" aria-label="Replays home" onClick={onClick}>
      {logo ? <img className="product-logo" src={logo} alt="" width={24} height={24} /> : <ProductMark size={24} svgRef={svg} />}
    </button>
  );
}

/* ---------- Identity ---------- */

/** Row 1, left: the mark (the "Replays home" button) and the page's h1, the product's name. */
export function IndexIdentity() {
  return (
    <div className="index-identity">
      <MarkButton />
      <h1 className="index-title">{productName()}</h1>
    </div>
  );
}

/* ---------- Command search ---------- */

interface QuickOption {
  id: string;
  kind: 'entry' | 'all';
  render: ReactNode;
  run: () => void;
}

/** The strings a quick search looks in. */
const searchText = (entry: FeedEntry) =>
  entry.kind === 'session'
    ? [
        entry.summary.title,
        entry.summary.id,
        entry.summary.url,
        entry.summary.host,
        ...(entry.summary.tags ?? []),
        ...(entry.summary.sources ?? []).map(sourceText),
      ]
    : [
        entry.suite.title,
        entry.suite.id,
        ...(entry.suite.subject ? [sourceText(entry.suite.subject)] : []),
        ...entry.suite.runDetails.map((run) => run.label),
      ];

/** Entries whose title, id, URL, host, tag or source text contains `query`, newest first. */
export function quickMatches(entries: readonly FeedEntry[], query: string, limit = 5) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return entries
    .filter((entry) => searchText(entry).some((value) => value.toLowerCase().includes(needle)))
    .toSorted((a, b) => entryTime(b).localeCompare(entryTime(a)))
    .slice(0, limit);
}

/**
 * The search field as a command bar (combobox pattern): typing filters the feed as before, and a small
 * listbox offers quick jumps to the top matches and "Show all results". ↑/↓ move,
 * Enter opens the active option (the first by default), Esc closes, then clears.
 */
export function CommandSearch({
  value,
  onChange,
  entries,
  total,
  compact,
}: {
  value: string;
  onChange: (value: string) => void;
  entries: readonly FeedEntry[] | undefined;
  /** How many feed results the query has (for "Show all"). */
  total: number | undefined;
  compact: boolean;
}) {
  // why: the platform is the browser's; a server render (and its hydration) shows the Ctrl key cap first.
  const searchKey = useHydrated() ? indexSearchShortcut() : 'Ctrl K';
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  // ⌘K / Ctrl+K and "/" jump to the search from anywhere on the index (not while typing elsewhere).
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inField = target?.closest('input, textarea, select, [contenteditable="true"]');
      if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      } else if (event.key === '/' && !inField && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const matches = useMemo(() => (entries ? quickMatches(entries, value) : []), [entries, value]);
  const options = useMemo<QuickOption[]>(() => {
    if (!value.trim()) return [];
    const list: QuickOption[] = matches.map((entry) => {
      const href = entry.kind === 'session' ? replayHref(entry.summary.id) : suiteHref(entry.suite.id);
      const posterId = entry.kind === 'session' ? entry.summary.id : suitePosterRun(entry.suite.runDetails)?.replayId;
      const host = entry.kind === 'session' ? entry.summary.host : (entry.hosts[0] ?? '');
      const title = entry.kind === 'session' ? entry.summary.title : entry.suite.title;
      const detail =
        entry.kind === 'session'
          ? [
              entry.summary.sources?.[0]
                ? sourceText(entry.summary.sources[0])
                : entry.summary.source === 'human'
                  ? 'rrweb import'
                  : 'Agent capture',
              formatRelative(entry.summary.capturedAt, undefined, 'narrow'),
            ]
          : [
              'Review suite',
              ...(entry.suite.subject ? [sourceText(entry.suite.subject)] : []),
              formatRelative(entry.suite.createdAt, undefined, 'narrow'),
            ];
      return {
        id: `${entry.kind}:${entry.id}`,
        kind: 'entry',
        // In-document, like a click on the row: same transition, same cache (routing/navigate.ts).
        run: () => {
          // Closed first: the index stays mounted behind the viewer and comes back as it was left.
          setOpen(false);
          if (!navigate(href)) location.assign(href);
        },
        render: (
          <>
            <span className={entry.kind === 'suite' ? 'command-thumb command-thumb-stack' : 'command-thumb'}>
              <Poster id={posterId} host={host} size="mini" />
            </span>
            <span className="command-text">
              <span className="command-title">{title}</span>
              <span className="command-detail">
                {entry.kind === 'suite' ? <LayersIcon aria-hidden="true" /> : null}
                {detail.join(' · ')}
              </span>
            </span>
          </>
        ),
      };
    });
    list.push({
      id: 'all',
      kind: 'all',
      run: () => {
        setOpen(false);
        document.querySelector('.feed-groups, .feed-list')?.scrollIntoView({ block: 'start' });
      },
      render: (
        <>
          <AnimatedIcon name="search" className="command-icon" />
          <span className="command-title">
            Show all {total === undefined ? '' : `${total} `}results for “{value.trim()}”
          </span>
        </>
      ),
    });
    return list;
  }, [matches, value, total]);

  const expanded = open && options.length > 0;
  const current = Math.min(active, Math.max(0, options.length - 1));
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!options.length) return;
      event.preventDefault();
      setOpen(true);
      setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if (event.key === 'Enter' && expanded) {
      event.preventDefault();
      options[current]?.run();
    } else if (event.key === 'Escape') {
      // A native search field clears itself on Escape; the first Escape only closes the results.
      event.preventDefault();
      if (expanded) setOpen(false);
      else if (value) onChange('');
      else input.current?.blur();
    }
  };

  return (
    // data-icon-host: entering the field (not just hovering it) plays the search glyph.
    <div className="command-search" role="search" data-icon-host>
      <label className="search-field command-field">
        <span className="visually-hidden">Search replays</span>
        <AnimatedIcon name="search" />
        <input
          ref={input}
          type="search"
          name="q"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded ? `${listId}-${current}` : undefined}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder="Search"
          value={value}
          onChange={(event) => {
            onChange(event.currentTarget.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => {
            setTyping(true);
            setOpen(true);
          }}
          onBlur={() => {
            setTyping(false);
            setOpen(false);
          }}
          onKeyDown={onKeyDown}
        />
        {compact ? null : (
          // The tooltip lives on the key cap, so entering the field never pops it over the results.
          <Hint label="Search replays" shortcut={`${searchKey} · ${INDEX_SEARCH_ALT_KEY}`} side="bottom" disabled={typing}>
            <span className="command-kbd" aria-hidden="true">
              <Kbd>{searchKey}</Kbd>
            </span>
          </Hint>
        )}
      </label>
      {/* The listbox stays in the DOM (aria-controls must resolve); hidden while closed. */}
      <div id={listId} role="listbox" aria-label="Quick results" className="command-results" hidden={!expanded}>
        {options.map((option, index) => (
          // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- keys are handled on the combobox input.
          <div
            key={option.id}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === current}
            className="command-option"
            data-kind={option.kind}
            // Keep the caret in the input; the click runs the option.
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => setActive(index)}
            onClick={() => option.run()}
          >
            {option.render}
            {index === current ? <AnimatedIcon name="corner-down-left" className="command-enter" trigger="state" play={current} /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Scope bar ---------- */

/**
 * Row 2, one toolbar: the profile tabs (`lead`) or, without profiles, the result count on the left; the active
 * filters, Filter, sort and layout (desktop) on the right. With tabs the count stays for screen readers only.
 */
export function ScopeBar({ count, lead, children }: { count: ReactNode; lead?: ReactNode; children?: ReactNode }) {
  return (
    <div className="scope-bar" data-lead={lead ? '' : undefined}>
      {lead}
      {count}
      {children ? <div className="scope-bar-end">{children}</div> : null}
    </div>
  );
}

/* ---------- Profile segments ---------- */

/** Entries per profile segment; `all` counts everything (an entry without a profile only counts there). */
export type ProfileCounts = Record<string, number> & { all: number };

/**
 * All · <each profile>: native radios (arrow keys), muted counts, a sliding underline. Only rendered when the
 * deployment defines profiles (src/client/profiles.ts); the choice lives in the URL as `profile=`.
 */
export function ProfileSegments({
  profiles,
  value,
  counts,
  onChange,
}: {
  profiles: readonly ProfileInfo[];
  value: string | undefined;
  counts: ProfileCounts | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const group = useRef<HTMLDivElement>(null);
  const indicator = useSlidingPill(group, { selector: `.profile-segment[data-segment="${value ?? ''}"]`, value });
  const segments = [{ id: undefined, label: 'All' }, ...profiles];
  return (
    <div className="profile-bar">
      <div ref={group} className="profile-segments" role="radiogroup" aria-label="Profile" data-testid="profile-segments">
        <span ref={indicator} className="profile-indicator" aria-hidden="true" />
        {segments.map((segment) => {
          const count = counts?.[segment.id ?? 'all'];
          return (
            <label key={segment.id ?? ''} className="profile-segment" data-segment={segment.id ?? ''}>
              <input
                type="radio"
                name="profile"
                className="visually-hidden"
                checked={value === segment.id}
                onChange={() => onChange(segment.id)}
              />
              <span className="profile-segment-label">
                {segment.label}
                {count === undefined ? null : <span className="profile-segment-count">{count}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
