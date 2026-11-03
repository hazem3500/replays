import { spring } from 'motion';

/**
 * The one spring every shared picture rides between the library and a viewer: lands in about 0.4 s with a barely
 * perceptible settle, a little quicker on the way back.
 * why: a 2 % overshoot on a picture that fills the stage reads as a wobble, and a long settle delays the player's mount.
 */
export const heroSpring = (returning: boolean) =>
  ({ type: spring, visualDuration: returning ? 0.36 : 0.4, bounce: returning ? 0.08 : 0.1 }) as const;

/**
 * When the destination picture fades in over the flying source: late on the way in, where the rectangles already
 * match; mid-flight on the way back, once the player has shrunk toward the card.
 */
export const heroCrossfade = (returning: boolean) => ({ delay: returning ? 0.1 : 0.22, duration: returning ? 0.18 : 0.16 });
