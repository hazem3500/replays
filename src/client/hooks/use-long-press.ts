import { type PointerEvent, useRef } from 'react';

/** A finger that drifts further than this (a scroll, a swipe) is not a long press. */
const DRIFT_PX = 10;

/**
 * Touch long press: `onLongPress` fires after `ms` of a still finger. The click that ends a long press is not a click
 * (`endsLongPress`), and the release that lands outside a menu it opened is not a dismissal (`holding`).
 */
export function useLongPress(onLongPress: () => void, ms: number) {
  const press = useRef({ timer: 0, x: 0, y: 0, fired: false, holding: false });
  const cancel = () => window.clearTimeout(press.current.timer);
  const release = () => {
    cancel();
    // why: the menu's outside-press check runs on this same release (a document listener, before this one).
    window.setTimeout(() => {
      press.current.holding = false;
    });
  };
  return {
    endsLongPress: () => {
      const fired = press.current.fired;
      press.current.fired = false;
      return fired;
    },
    holding: () => press.current.holding,
    handlers: {
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        press.current.fired = false;
        if (event.pointerType !== 'touch') return;
        cancel();
        press.current.x = event.clientX;
        press.current.y = event.clientY;
        press.current.timer = window.setTimeout(() => {
          press.current.fired = true;
          press.current.holding = true;
          onLongPress();
        }, ms);
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        if (Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > DRIFT_PX) cancel();
      },
      onPointerUp: release,
      onPointerCancel: release,
      onPointerLeave: cancel,
    },
  };
}
