import { spring } from 'motion';
import { flushSync } from 'react-dom';

import { motionView } from './motion-view.ts';
import { forgetHint } from './open-hint.ts';
import { namePicture, unnameAll, viewerPicture } from './shared-elements.ts';
import { abandon, currentTransition, follow, isTurn, nextTurn, setSwappingInPlace, supportsTransitions } from './state.ts';

/* why: in-place swaps (a suite's runs). The runs sidebar stays perfectly still (its live layer, so only its selection
 * glides), the frame crossfades between the two runs at its rect (resizing smoothly if the aspect differs), the top
 * bar and transport crossfade in place, and Motion brings the step rail and panel in with a 4 px rise.
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
  for (const panel of ['.app-shell .timeline-panel', '.app-shell .inspector']) {
    view
      .add(panel, panel)
      .layout({ duration: 0 })
      .old({ opacity: [1, 1] })
      .new({ opacity: [0, 1], transform: ['translateY(4px)', 'translateY(0px)'] }, { duration: 0.22 });
  }
  const sidebar = '.suite-sidebar';
  view
    .add(sidebar, sidebar)
    .layout({ duration: 0 })
    .old({ opacity: [0, 0] })
    .new({ opacity: [1, 1] });
}

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
    namePicture(viewerPicture(), 'vt-run-hero');
    root.dataset.pageTransition = 'motion-run';
    let committed = false;
    const transition = motionView(() => {
      if (!isTurn(turn) || committed) return;
      committed = true;
      unnameAll();
      setSwappingInPlace(true);
      try {
        flushSync(update);
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
      flushSync(update);
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
