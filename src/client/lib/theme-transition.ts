import { flushSync } from 'react-dom';

import type { Theme } from '../theme.tsx';

interface ThemeChange {
  target: Theme;
  transition?: ViewTransition;
  finish: () => void;
}

let active: ThemeChange | undefined;

/** Keeps component hover transitions out of the page-wide theme crossfade. */
function holdTransitions() {
  const blocker = document.createElement('style');
  blocker.dataset.themeSwitch = '';
  blocker.textContent = '*,*::before,*::after{transition:none!important}';
  document.head.append(blocker);
  return () => {
    void document.documentElement.offsetHeight;
    requestAnimationFrame(() => blocker.remove());
  };
}

/** Rapid toggles settle immediately on the latest choice instead of stacking page snapshots. */
export function switchThemeWithTransition(apply: (theme: Theme) => void) {
  const root = document.documentElement;
  const previous = active;
  const target = (previous?.target ?? root.dataset.theme) === 'light' ? 'dark' : 'light';
  previous?.transition?.skipTransition();
  previous?.finish();

  const release = holdTransitions();
  const change: ThemeChange = {
    target,
    finish: () => {
      if (active !== change) return;
      active = undefined;
      delete root.dataset.themeSwitching;
      release();
    },
  };
  active = change;
  const commit = () => {
    if (active === change) flushSync(() => apply(target));
  };

  if (previous || !document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    commit();
    change.finish();
    return;
  }

  root.dataset.themeSwitching = 'fade';
  try {
    change.transition = document.startViewTransition(commit);
    void change.transition.ready.catch(() => {});
    void change.transition.finished.then(change.finish, change.finish);
  } catch {
    commit();
    change.finish();
  }
}
