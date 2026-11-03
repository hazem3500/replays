import { animateView } from 'motion';
import { deferred } from '../lib/deferred.ts';

import type { PageTransition } from './state.ts';

interface ViewPlayback {
  finished: Promise<unknown>;
  complete: () => void;
  play: () => void;
}

function isPlayback(value: unknown): value is ViewPlayback {
  return (
    typeof value === 'object' &&
    value !== null &&
    'finished' in value &&
    value.finished instanceof Promise &&
    'complete' in value &&
    typeof value.complete === 'function' &&
    'play' in value &&
    typeof value.play === 'function'
  );
}

/** Completes the controls of a transition the browser has already ended, so their finished promise can settle. */
function settle(controls: ViewPlayback) {
  try {
    controls.complete();
  } catch {
    // why: a layer removed with its pseudo-element may refuse to finish; the browser has already dropped it.
  }
}

/**
 * Motion owns the spring, layout, crop and snapshot animations. The browser only captures the live recorded page,
 * so React never clones or reparents its iframe. This bridge preserves the router's commit and player-ready gates.
 */
export function motionView(
  update: () => void | Promise<void>,
  configure: (view: ReturnType<typeof animateView>) => void,
  prepare?: () => void,
): PageTransition & { updateCallbackDone: Promise<void> } {
  const ready = deferred();
  const finished = deferred();
  const committed = deferred();
  let playback: ViewPlayback | undefined;
  let skipped = false;
  let updating: Promise<void> | undefined;
  const run = () => {
    updating ??= Promise.resolve()
      .then(update)
      .then(committed.resolve, (error: unknown) => {
        committed.reject(error);
        throw error;
      });
    return updating;
  };
  const failed = () => {
    ready.resolve();
    // why: capture can be refused before the update callback; the actual navigation must still happen once.
    void run().then(finished.resolve, finished.resolve);
  };
  // why: Motion's immediate queue invokes updates without awaiting them; router commits must finish before capture.
  const view = animateView(run, { interrupt: 'wait', duration: 0.16, ease: 'easeOut' });
  configure(view);
  // why: Motion 14.9's then declaration omits the documented controls argument; validate it without an unsafe cast.
  void view
    .then((...values: unknown[]) => {
      const controls = values[0];
      if (!isPlayback(controls)) {
        failed();
        return;
      }
      playback = controls;
      const native = (document as Document & { activeViewTransition?: ViewTransition | null }).activeViewTransition;
      prepare?.();
      if (skipped) controls.complete();
      else controls.play();
      ready.resolve();
      // why: constructing players before the browser removes its snapshot layers stalls the final compositor handoff.
      void Promise.allSettled([native ? native.finished : controls.finished]).then(() => {
        // invariant: an aborted transition cancels its layers' animations; Motion's queue waits on them before the next one.
        if (native) settle(controls);
        finished.resolve();
      });
    }, failed)
    .catch(failed);
  return {
    ready: ready.promise,
    finished: finished.promise,
    updateCallbackDone: committed.promise,
    skipTransition: () => {
      skipped = true;
      playback?.complete();
    },
  };
}
