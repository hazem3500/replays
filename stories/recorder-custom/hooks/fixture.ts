import { useEffect, useState } from 'react';
import { createDeferredUi, createRecorder } from '@hazem3500/replays/recorder';
import { createFakeRrweb } from '../../../src/recorder/testing/fakes.ts';
export type Mode = 'consent' | 'recording' | 'warning' | 'final' | 'uploading' | 'sent' | 'failed';
function createFixture(mode: Mode) {
  const deferred = createDeferredUi();
  let attempts = 0;
  const recorder = createRecorder({
    ui: deferred.ui,
    loadRrweb: createFakeRrweb().load,
    activation: () => true,
    privacy: { consoleLevels: [], captureNetwork: false },
    upload: async (_report, { signal, onProgress }) => {
      onProgress?.({ loaded: 40, total: 100 });
      if (mode === 'uploading')
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('Discarded')), { once: true }),
        );
      if (mode === 'failed' && attempts++ === 0) throw new Error('Offline');
      return { replayId: 'custom-demo', reference: 'REC-42' };
    },
  });
  const elapsedByMode: Partial<Record<Mode, number>> = { warning: 152000, final: 172000 };
  const elapsed = elapsedByMode[mode] ?? 73000;
  return {
    recorder,
    deferred,
    now: () => {
      const state = recorder.getState();
      return state.status === 'recording' ? state.startedAt + elapsed : Date.now();
    },
  };
}
export function useRecorderFixture(mode: Mode): ReturnType<typeof createFixture> {
  const [fixture] = useState(() => createFixture(mode));
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (mode === 'consent') {
        void fixture.recorder.request();
        return;
      }
      await fixture.recorder.start({ consent: true });
      if (cancelled) return;
      if (['uploading', 'sent', 'failed'].includes(mode)) {
        fixture.recorder.stop();
        await fixture.recorder.upload({ confirmed: true }).catch(() => {});
      }
    };
    void run().catch(() => {});
    return () => {
      cancelled = true;
      fixture.recorder.discard();
    };
  }, [fixture, mode]);
  return fixture;
}
