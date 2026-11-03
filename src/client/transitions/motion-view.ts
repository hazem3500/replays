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

/** The browser animations behind Motion's controls: its view layers, retimed or created for this transition. */
function layerAnimations(controls: ViewPlayback) {
  const children: unknown = 'animations' in controls ? controls.animations : undefined;
  if (!Array.isArray(children)) return [];
  return children.flatMap((child: unknown) =>
    typeof child === 'object' && child !== null && 'animation' in child && child.animation instanceof Animation ? [child.animation] : [],
  );
}

/**
 * Lets Motion's controls settle once the browser has ended their transition, without reviving any layer.
 * invariant: finishing a layer the browser cancelled brings it back under its pseudo-element's name; there it styles,
 * or stops the browser from restarting, the next transition's layer of that name (an interrupted Back stood still).
 */
function settle(controls: ViewPlayback) {
  for (const animation of layerAnimations(controls)) {
    if (animation.playState === 'finished') continue;
    animation.cancel();
    animation.onfinish?.call(animation, new AnimationPlaybackEvent('finish'));
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
  let native: ViewTransition | null | undefined;
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
      native = (document as Document & { activeViewTransition?: ViewTransition | null }).activeViewTransition;
      prepare?.();
      if (!skipped) controls.play();
      else if (native) native.skipTransition();
      else controls.complete();
      ready.resolve();
      // why: constructing players before the browser removes its snapshot layers stalls the final compositor handoff.
      const browser = native;
      void Promise.allSettled([browser ? browser.finished : controls.finished]).then(() => {
        // invariant: an ended or aborted transition drops its layers; Motion's queue waits on them before the next one.
        if (browser) settle(controls);
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
      // why: the browser ends its own transition; completing Motion's layers would revive them for the next one.
      if (native) native.skipTransition();
      else playback?.complete();
    },
  };
}
