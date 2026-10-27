import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { createDeferredUi, createRecorder } from '@hazem3500/replays/recorder';
import { RecorderProvider } from '@hazem3500/replays/recorder/react';
import { createFakeRrweb } from '../../src/recorder/testing/fakes.ts';
import { RecorderUi } from '../../examples/recorder-shadcn/src/RecorderUi.tsx';

type Mode = 'consent' | 'recording' | 'warning' | 'final' | 'uploading' | 'sent' | 'failed';
function RecorderCustom({ mode = 'consent', phone = false }: { mode?: Mode; phone?: boolean }) {
  const [fixture] = useState(() => {
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
    const elapsed = mode === 'warning' ? 152000 : mode === 'final' ? 172000 : 73000;
    return {
      recorder,
      deferred,
      now: () => {
        const state = recorder.getState();
        return state.status === 'recording' ? state.startedAt + elapsed : Date.now();
      },
    };
  });
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
  return (
    <div style={{ width: phone ? 320 : '100%', minHeight: 400, padding: 24 }}>
      <RecorderProvider recorder={fixture.recorder} deferred={fixture.deferred}>
        <RecorderUi now={fixture.now} />
      </RecorderProvider>
    </div>
  );
}
const meta = { title: 'App/Recorder/RecorderCustom', component: RecorderCustom, parameters: { layout: 'fullscreen' } } satisfies Meta<
  typeof RecorderCustom
>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Consent: Story = { args: { mode: 'consent' } };
export const Recording: Story = { args: { mode: 'recording' } };
export const Warning: Story = { args: { mode: 'warning' } };
export const FinalWarning: Story = { args: { mode: 'final' } };
export const Uploading40Percent: Story = { args: { mode: 'uploading' } };
export const Sent: Story = { args: { mode: 'sent' } };
export const FailedWithRetry: Story = { args: { mode: 'failed' } };
export const Phone320: Story = {
  args: { mode: 'recording', phone: true },
  globals: { viewport: { value: 'mobile320', isRotated: false } },
};
