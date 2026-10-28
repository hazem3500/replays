import { useEffect, useState } from 'react';
import { createAnnouncer } from '../../kit/index.ts';
import type { Recorder } from '../../types.ts';

function recorderLifetime(recorder: Recorder) {
  let generation = 0;
  return {
    mount(owned: boolean): () => void {
      const token = ++generation;
      return () => {
        queueMicrotask(() => {
          if (generation === token && owned) recorder.destroy();
        });
      };
    },
  };
}
export function useRecorderLifetime(recorder: Recorder, owned: boolean): void {
  const [lifetime] = useState(() => recorderLifetime(recorder));
  useEffect(() => lifetime.mount(owned), [lifetime, owned]);
}
export function useStopControl(recorder: Recorder): (element: HTMLElement | null) => void {
  const [register] = useState(() => {
    let release: (() => void) | undefined;
    return (element: HTMLElement | null): void => {
      release?.();
      release = element ? recorder.attestStop(element) : undefined;
    };
  });
  return register;
}
type Say = (text: string, politeness?: 'polite' | 'assertive') => void;
function announcements(): { say: Say; dispose: () => void } {
  let announcer: ReturnType<typeof createAnnouncer> | undefined;
  return {
    say(text, politeness) {
      announcer ??= createAnnouncer();
      announcer.say(text, politeness);
    },
    dispose() {
      announcer?.dispose();
      announcer = undefined;
    },
  };
}
export function useLiveAnnouncements(): Say {
  const [controller] = useState(announcements);
  useEffect(() => () => controller.dispose(), [controller]);
  return controller.say;
}
