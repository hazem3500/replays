import NumberFlow from '@number-flow/react';
import { useRef } from 'react';

import { cn } from '@/lib/utils.ts';

/** A change this soon after the previous one (continuous playback, a held key) snaps instead of animating. */
const COALESCE_MS = 250;

let keyRepeatAt = 0;
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.repeat) keyRepeatAt = performance.now();
    },
    { capture: true },
  );
}

/** Decides per change whether to animate: only discrete, settled changes do (a step click, [ ], E, a seek). */
function settledChange(memory: { value: number; at: number }, value: number) {
  if (memory.value === value) return true;
  const now = performance.now();
  const animate = now - memory.at >= COALESCE_MS && now - keyRepeatAt >= COALESCE_MS;
  memory.value = value;
  memory.at = now;
  return animate;
}

/**
 * A count that rolls to its new value (NumberFlow, MIT): digits spin by direction over ~240 ms with a ~150 ms
 * fade, tabular and in the surrounding font. Rapid changes (playback ticking through entries, key repeat)
 * update without motion; reduced motion turns it off (respectMotionPreference). NumberFlow keeps the plain
 * value as accessible text and hides the animated digits.
 *
 * `instant` snaps every change (a count that must match something else on screen at the same moment, e.g. the
 * step number while the replay plays and the caption shows it too).
 *
 * Use for counts that change meaningfully (tab counts, "Step N of M", the error navigator, stats), not for
 * running clocks or per-row values.
 */
export function AnimatedNumber({ value, className, instant = false }: { value: number; className?: string; instant?: boolean }) {
  const memory = useRef({ value, at: 0 });
  // Reading the clock and the last change at render time is deliberate: the decision belongs to this change.
  // oxlint-disable-next-line react/refs
  const animated = settledChange(memory.current, value) && !instant;
  return (
    <NumberFlow
      value={value}
      className={cn('animated-number', className)}
      animated={animated}
      respectMotionPreference
      spinTiming={{ duration: 240, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }}
      transformTiming={{ duration: 240, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }}
      opacityTiming={{ duration: 150, easing: 'ease-out' }}
      format={{ useGrouping: false }}
      willChange={false}
    />
  );
}
