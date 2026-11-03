interface Halting {
  stop(): void;
  cancel(): void;
}

/**
 * Stops an animation where it is. A target that is no longer rendered (detached or under `display: none`) cannot
 * commit its styles, and the browser throws instead, so that animation is cancelled; nothing is visible to keep.
 */
export function haltMotion(node: Element, controls: Halting) {
  if (node.isConnected && node.getClientRects().length > 0) controls.stop();
  else controls.cancel();
}
