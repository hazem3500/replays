import { spring } from 'motion';

/**
 * The one spring every shared picture rides between the library and a viewer: a quick launch and a lively, slightly
 * underdamped settle, a little quicker on the way back.
 * why: the library's stacks fan out with character; an eased glide reads as calm and slow.
 */
export const heroSpring = (returning: boolean) => ({ type: spring, duration: returning ? 0.46 : 0.52, bounce: 0.24 }) as const;

/** How long the source lingers under the opaque destination before it lets go of any edge the destination misses. */
const SOURCE_RELEASE = 0.06;

/**
 * The flying picture's two layers. The destination fades in over the source (as the spring first reaches its target on
 * the way in; mid-flight on the way back, once the player has shrunk toward the card) while the source stays opaque
 * beneath it, and only then lets go.
 * invariant: a hero is never partly see-through. Fading both layers at once covered only 75 % at the midpoint, so the
 * page behind flashed through every flying suite sheet.
 */
export function heroLayers(returning: boolean) {
  const delay = returning ? 0.06 : 0.16;
  const duration = 0.14;
  const end = delay + duration;
  return {
    source: {
      keyframes: { opacity: [1, 1, 0] },
      options: { duration: end + SOURCE_RELEASE, times: [0, end / (end + SOURCE_RELEASE), 1], ease: 'linear' as const },
    },
    destination: { keyframes: { opacity: [0, 1] }, options: { delay, duration } },
  };
}
