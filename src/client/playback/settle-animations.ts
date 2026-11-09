/**
 * A paused seek rebuilds the page in one pass, so every CSS animation and transition the recording had running
 * starts again at its first frame and never advances (a Radix modal's fade-in/zoom-in stays at opacity 0). Playback
 * would have run them to their end by the time the target is on screen, so finish the ones that can end.
 */
interface AnimationLike {
  playState: AnimationPlayState;
  effect: { getComputedTiming(): { iterations?: number; duration?: unknown } } | null;
  finish(): void;
}

export function settleAnimations(doc: { getAnimations?: () => Iterable<AnimationLike> } | null | undefined) {
  if (!doc || typeof doc.getAnimations !== 'function') return;
  for (const animation of doc.getAnimations()) {
    if (animation.playState === 'finished' || animation.playState === 'idle') continue;
    const { iterations, duration } = animation.effect?.getComputedTiming() ?? {};
    if (iterations === undefined || !Number.isFinite(iterations) || typeof duration !== 'number') continue;
    try {
      animation.finish();
    } catch {
      continue;
    }
  }
}
