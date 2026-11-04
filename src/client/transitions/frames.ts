const FADE_CAP_MS = 300;

const wait = (ms: number) => new Promise<void>((done) => window.setTimeout(done, ms));

function isFrameFade(animation: Animation) {
  const { effect } = animation;
  return (
    effect instanceof KeyframeEffect &&
    effect.pseudoElement === '::after' &&
    effect.target instanceof Element &&
    effect.target.matches('.ct-tile')
  );
}

/**
 * Fades the comparison tiles' run-colour frames out and resolves once they are gone, so the snapshot a page change
 * captures next has none. Opening needs no call: `html[data-page-transition]` keeps frames hidden until it lands.
 */
export async function hideTileFrames(root: HTMLElement) {
  root.dataset.framesLeaving = '';
  // why: reading the animations flushes style, so the opacity transition the attribute starts is already listed.
  const fades = document.getAnimations().filter(isFrameFade);
  // why: a fade the browser never advances (a background tab) must not hold navigation.
  await Promise.race([Promise.allSettled(fades.map((fade) => fade.finished)), wait(FADE_CAP_MS)]);
}

export function showTileFrames(root: HTMLElement) {
  delete root.dataset.framesLeaving;
}
