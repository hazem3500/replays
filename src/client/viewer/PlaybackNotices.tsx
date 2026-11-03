import { FastForwardIcon } from 'lucide-react';
import { useState } from 'react';

import { usePlaybackNoticeMotion } from '../hooks/use-playback-notice-motion.ts';
import { usePlayerState } from '../player.ts';

/** A rate-change notice runs once in wall-clock time, independently of replay speed. */
export function SpeedHud({ speed }: { speed: number }) {
  const ref = usePlaybackNoticeMotion('speed');
  return (
    <div ref={ref} className="speed-hud" aria-hidden="true" data-testid="speed-hud">
      {speed}×
    </div>
  );
}

/** Retains the last skip label while its pill leaves; announcements still follow the current gap. */
export function SkipIndicator() {
  const { skipping } = usePlayerState();
  const seconds = skipping ? ((skipping.to - skipping.from) / 1000).toFixed(1) : undefined;
  const [lastSeconds, setLastSeconds] = useState(seconds);
  if (seconds !== undefined && seconds !== lastSeconds) setLastSeconds(seconds);
  const ref = usePlaybackNoticeMotion('skip', Boolean(skipping));
  return (
    <>
      <div ref={ref} className="skip-indicator" data-visible={skipping ? '' : undefined} aria-hidden="true" data-testid="skip-indicator">
        <FastForwardIcon aria-hidden="true" />
        {lastSeconds ? `Skipping ${lastSeconds} s of inactivity` : null}
      </div>
      <span className="visually-hidden" role="status">
        {seconds ? `Skipping ${seconds} seconds of inactivity` : ''}
      </span>
    </>
  );
}
