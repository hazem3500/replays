import { spring } from 'motion';
import { flushSync } from 'react-dom';

import { motionView } from './motion-view.ts';
import { forgetHint } from './open-hint.ts';
import { namePicture, unnameAll, viewerPicture } from './shared-elements.ts';
import { abandon, currentTransition, follow, isTurn, nextTurn, setSwappingInPlace, supportsTransitions } from './state.ts';

/* why: in-place swaps (a suite's runs). The runs sidebar stays perfectly still (its live layer, so only its selection
 * glides), the frame crossfades between the two runs at its rect (resizing smoothly if the aspect differs), the top
 * bar and transport crossfade in place, and the step rail and inspector swap at once without moving.
 * The new run renders complete inside the update (rrweb included: a crossfade has nothing to stall), and the old one
 * stays on screen while its data loads, up to a short wait. A switch while one runs (a held J) lands at once.
 */

const RUN_WAIT_MS = 1200;
/** How long a started crossfade may take to apply the new run before it lands without one. */
const COMMIT_WAIT_MS = 400;

/** How long a crossfade may take to finish before the swap stops waiting on it. */
const FINISH_WAIT_MS = 2000;

const delay = (ms: number) => new Promise<void>((done) => window.setTimeout(done, ms));

type RunView = Parameters<Parameters<typeof motionView>[1]>[0];

function describeRunTransition(view: RunView) {
  view.old({ opacity: [1, 1] }).new({ opacity: [0, 1] }, { duration: 0.2 });
  view
    .add('[style*="view-transition-name: vt-run-hero"]')
    .group(false)
    .crop(true)
    .layout({ type: spring, duration: 0.28, bounce: 0.06 })
    .old({ opacity: [1, 1] }, { duration: 0.2 })
    .new({ opacity: [0, 1] }, { duration: 0.2 });
  // why: the sidebar, step rail and inspector keep their place and chrome across runs; only their rows change, so they
  // swap at once instead of fading or rising (a crossfade there reads as the panel flickering).
  for (const still of ['.suite-sidebar', '.app-shell .timeline-panel', '.app-shell .inspector']) {
    view
      .add(still, still)
      .layout({ duration: 0 })
      .old({ opacity: [0, 0] })
      .new({ opacity: [1, 1] });
  }
}

/** How long after a run swap commits its new panels may still be starting their arrival motion. */
const SETTLE_MS = 700;

/**
 * why: a run swap remounts the run's view in place of the old one, so every panel's arrival motion (rows rising, tab
 * indicators sliding, chips and counters popping, splitters fading in) would replay on each switch and read as the
 * page flickering. Whatever starts inside the run's view after the swap lands at its end state at once; the
 * crossfades the swap itself draws (view-transition layers) and endless loaders are left alone.
 */
function settled(update: () => void) {
  const root = document.querySelector('.suite-viewer');
  const seen = new WeakSet<Animation>(document.getAnimations());
  update();
  if (!root) return;
  const until = performance.now() + SETTLE_MS;
  const sweep = () => {
    for (const animation of document.getAnimations()) {
      if (seen.has(animation)) continue;
      seen.add(animation);
      const effect = animation.effect;
      if (!(effect instanceof KeyframeEffect) || effect.pseudoElement || !effect.target || !root.contains(effect.target)) continue;
      if (effect.getComputedTiming().iterations === Number.POSITIVE_INFINITY) continue;
      animation.finish();
    }
    if (performance.now() < until) requestAnimationFrame(sweep);
  };
  sweep();
}

export function swapInPlace(update: () => void, ready: Promise<unknown>, { instant = false }: { instant?: boolean } = {}) {
  const root = document.documentElement;
  root.dataset.navigated = '';
  forgetHint();
  const running = Boolean(currentTransition());
  const turn = nextTurn();
  if (instant || running || !supportsTransitions()) {
    settled(update);
    return;
  }
  void Promise.race([ready.catch(() => {}), delay(RUN_WAIT_MS)]).then(() => {
    if (!isTurn(turn)) return;
    if (currentTransition()) {
      settled(update);
      return;
    }
    unnameAll();
    namePicture(viewerPicture(), 'vt-run-hero');
    root.dataset.pageTransition = 'motion-run';
    let committed = false;
    const transition = motionView(() => {
      if (!isTurn(turn) || committed) return;
      committed = true;
      unnameAll();
      setSwappingInPlace(true);
      try {
        settled(() => flushSync(update));
      } finally {
        setSwappingInPlace(false);
      }
      namePicture(viewerPicture(), 'vt-run-hero');
    }, describeRunTransition);
    follow(transition);
    // why: a crossfade queued behind one a quick switch cut short can wait forever; the run must still change.
    window.setTimeout(() => {
      if (committed || !isTurn(turn)) return;
      committed = true;
      transition.skipTransition();
      // why: a transition stuck in Motion's queue never finishes, and the new run's player waits for it to mount.
      abandon(transition);
      unnameAll();
      delete root.dataset.pageTransition;
      settled(() => flushSync(update));
    }, COMMIT_WAIT_MS);
    // why: Motion can leave a crossfade unfinished (its layers never settle); the next run's player waits on it to mount.
    void Promise.race([
      transition.finished.then(
        () => true,
        () => true,
      ),
      delay(FINISH_WAIT_MS).then(() => false),
    ]).then((finished) => {
      if (!finished) {
        transition.skipTransition();
        abandon(transition);
      }
      if (!isTurn(turn)) return;
      delete root.dataset.pageTransition;
      unnameAll();
    });
  });
}
