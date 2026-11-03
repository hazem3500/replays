import { flushSync } from 'react-dom';

import type { Theme } from '../theme.tsx';
import { motionView } from '../transitions/motion-view.ts';

interface ThemeChange {
  target: Theme;
  stop?: () => void;
  commit?: () => void;
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
  previous?.stop?.();
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
  change.commit = commit;

  if (previous || !document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    commit();
    change.finish();
    return;
  }

  root.dataset.themeSwitching = 'fade';
  try {
    const transition = motionView(commit, (view) => {
      view.old({ opacity: 1 }, { duration: 0.18 }).new({ opacity: [0, 1] }, { duration: 0.18 });
    });
    change.stop = () => transition.skipTransition();
    void transition.finished.then(change.finish, change.finish);
    void transition.updateCallbackDone.catch(() => {});
  } catch {
    commit();
    change.finish();
  }
}

export function settleThemeTransition() {
  active?.commit?.();
  active?.stop?.();
  active?.finish();
}
