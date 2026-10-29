import { flushSync } from 'react-dom';

import { forgetHint } from './open-hint.ts';
import { name, unnameAll } from './shared-elements.ts';
import { currentTransition, follow, isTurn, nextTurn, setSwappingInPlace, supportsTransitions } from './state.ts';

/* why: in-place swaps (a suite's runs). The runs sidebar stays perfectly still (its live layer, so only its selection
 * glides), the frame crossfades between the two runs at its rect (resizing smoothly if the aspect differs), the top
 * bar and transport crossfade in place, and the step rail and panel crossfade with a 4 px rise (styles.css, "run").
 * The new run renders complete inside the update (rrweb included: a crossfade has nothing to stall), and the old one
 * stays on screen while its data loads, up to a short wait. A switch while one runs (a held J) lands at once.
 */

const RUN_WAIT_MS = 1200;

const delay = (ms: number) => new Promise<void>((done) => window.setTimeout(done, ms));

export function swapInPlace(update: () => void, ready: Promise<unknown>, { instant = false }: { instant?: boolean } = {}) {
  const root = document.documentElement;
  root.dataset.navigated = '';
  forgetHint();
  const running = Boolean(currentTransition());
  const turn = nextTurn();
  if (instant || running || !supportsTransitions()) {
    update();
    return;
  }
  void Promise.race([ready.catch(() => {}), delay(RUN_WAIT_MS)]).then(() => {
    if (!isTurn(turn)) return;
    if (currentTransition()) {
      update();
      return;
    }
    unnameAll();
    name(document.querySelector('.app-shell .player-frame'), 'vt-hero');
    root.dataset.pageTransition = 'run';
    const transition = document.startViewTransition(() => {
      unnameAll();
      setSwappingInPlace(true);
      try {
        flushSync(update);
      } finally {
        setSwappingInPlace(false);
      }
      name(document.querySelector('.app-shell .player-frame, .app-shell .sk-frame'), 'vt-hero');
    });
    follow(transition);
    void transition.finished
      .catch(() => {})
      .then(() => {
        if (currentTransition()) return;
        delete root.dataset.pageTransition;
        unnameAll();
      });
  });
}
