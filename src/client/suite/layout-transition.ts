import { flushSync } from 'react-dom';

const MORPH = 'vt-layout-run';

const named = (element: Element | null | undefined) => {
  if (!(element instanceof HTMLElement)) return undefined;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? element : undefined;
};

/**
 * Single ⇄ tiles in a suite: the runs sidebar holds still, the stage crossfades, and the run on screen morphs
 * between the single viewer's player and its tile (suite-layout.css). Grid ⇄ spotlight never comes here: those tiles glide
 * in place. Without View Transitions, or with reduced motion, the change lands at once.
 */
export function crossfadeLayout(update: () => void, from: () => Element | null, to: () => Element | null) {
  const root = document.documentElement;
  if (typeof document.startViewTransition !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update();
    return;
  }
  const before = named(from());
  if (before) before.style.viewTransitionName = MORPH;
  root.dataset.pageTransition = 'layout';
  let after: HTMLElement | undefined;
  const transition = document.startViewTransition(() => {
    if (before) before.style.viewTransitionName = '';
    flushSync(update);
    after = named(to());
    if (after && before) after.style.viewTransitionName = MORPH;
  });
  void transition.ready.catch(() => undefined);
  void transition.finished
    .catch(() => undefined)
    .then(() => {
      if (after) after.style.viewTransitionName = '';
      if (root.dataset.pageTransition === 'layout') delete root.dataset.pageTransition;
    });
}
