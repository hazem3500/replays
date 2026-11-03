import { animate } from 'motion/mini';
import { useLayoutEffect } from 'react';

import { useMediaQuery } from '../media.ts';

const CONTENT = '.timeline-panel .timeline-wrap:not([data-staggered]), .inspector-panel:not([data-staggered]) > :not([data-staggered])';
const PULSE =
  '.skeleton, .feed-skeleton .poster, .run-seg[data-tone="running"], .sk-topbar[data-untitled] .topbar-title-text, .index-status-running .index-status-dot';
const TARGETS = `${PULSE}, .skel-appear, .skeleton-shell, .skeleton-suite, .app-shell:not(.skeleton-shell), ${CONTENT}`;
const MAX_TARGETS = 240;
type Owned = { kind: string; stop(): void; restore(): void };

function loadingShell(element: HTMLElement) {
  return (
    !element.hasAttribute('data-instant') && !(element.matches('.skeleton-shell') && element.parentElement?.closest('.skeleton-suite'))
  );
}

function loadingKind(element: HTMLElement, landed: number) {
  if (element.matches(PULSE)) return element.closest('.panel-pending') ? '' : 'pulse';
  if (element.matches('.skel-appear')) return 'appear';
  if (element.matches('.skeleton-shell, .skeleton-suite')) return loadingShell(element) ? 'loading' : '';
  if (element.matches('.app-shell')) return document.documentElement.hasAttribute('data-navigated') ? '' : 'shell';
  return document.documentElement.hasAttribute('data-landed') ? `content:${landed}` : '';
}

const TIMING: Record<string, { duration: number; delay: number }> = {
  pulse: { duration: 1.2, delay: 0 },
  appear: { duration: 0.2, delay: 0.2 },
  loading: { duration: 0.18, delay: 0.15 },
};

function loadingEntry(element: HTMLElement, kind: string, options: { owned: Map<HTMLElement, Owned>; initial: boolean; reduced: boolean }) {
  const { owned, initial, reduced } = options;
  if (owned.get(element)?.kind === kind) return;
  owned.get(element)?.stop();
  owned.get(element)?.restore();
  const opacity = element.style.opacity;
  const entry: Owned = {
    kind,
    stop: () => {},
    restore: () => {
      element.style.setProperty('opacity', opacity);
    },
  };
  owned.set(element, entry);
  if (!kind || initial || reduced || typeof element.animate !== 'function') return;
  const pulse = kind === 'pulse';
  const from = kind === 'shell' ? 0.6 : 0;
  const animation = animate(
    [element],
    { opacity: pulse ? [1, 0.45] : [from, 1] },
    {
      ...(TIMING[kind] ?? { duration: 0.16, delay: 0 }),
      ease: [0.23, 1, 0.32, 1],
      ...(pulse ? { repeat: Infinity, repeatType: 'reverse' as const } : {}),
    },
  );
  entry.stop = () => animation.stop();
  if (!pulse)
    void animation.then(() => {
      if (owned.get(element) === entry) entry.restore();
    });
}

function scanLoading(root: HTMLElement, owned: Map<HTMLElement, Owned>, options: { initial: boolean; reduced: boolean; landed: number }) {
  const elements = [...root.querySelectorAll<HTMLElement>(TARGETS)].slice(0, MAX_TARGETS);
  const present = new Set(elements);
  for (const [element, entry] of owned) {
    if (present.has(element) && element.isConnected) continue;
    entry.stop();
    entry.restore();
    owned.delete(element);
  }
  for (const element of elements)
    loadingEntry(element, loadingKind(element, options.landed), { owned, initial: options.initial, reduced: options.reduced });
}

/** Scopes authored loading motion to the application root, leaving SSR paint and public composition alone. */
export function useLoadingMotion() {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useLayoutEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;
    const owned = new Map<HTMLElement, Owned>();
    let live = true;
    let queued = false;
    let landed = 0;
    const scan = (initial = false) => scanLoading(root, owned, { initial, reduced, landed });
    const schedule = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (live) scan();
      });
    };
    scan(true);
    const tree = new MutationObserver(schedule);
    tree.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-instant', 'data-untitled', 'data-staggered', 'data-tone'],
    });
    const page = new MutationObserver(() => {
      landed += 1;
      schedule();
    });
    page.observe(document.documentElement, { attributes: true, attributeFilter: ['data-landed'] });
    return () => {
      live = false;
      tree.disconnect();
      page.disconnect();
      for (const entry of owned.values()) {
        entry.stop();
        entry.restore();
      }
      owned.clear();
    };
  }, [reduced]);
}
