import { useEffect } from 'react';
import { RecorderHost } from './fixtures/recorder-host.tsx';
import { createDefaultUi } from '../src/recorder/default-ui.ts';

export type RecorderFixtureMode = 'consent' | 'recording' | 'uploading' | 'success' | 'error';

const FIXED_NOW = new Date('2026-10-27T12:00:00.000Z').getTime();

/** Drives the real framework-free recorder UI without creating a recorder or loading rrweb. */
export function RecorderFixture({
  mode,
  theme = 'dark',
  compact = false,
}: {
  mode: RecorderFixtureMode;
  theme?: 'dark' | 'light';
  compact?: boolean;
}) {
  useEffect(() => {
    const originalNow = Date.now;
    Date.now = () => FIXED_NOW;

    const controller = makeStubController();
    const ui = createDefaultUi({
      theme,
      privacyMode: 'masked',
      ...(compact ? { container: () => document.querySelector<HTMLElement>('[data-recorder-stage]')! } : {}),
      completion: {
        actions: [
          {
            id: 'open-replay',
            kind: 'link',
            label: 'Open replay',
            href: 'https://replays.example/replay/demo-42',
          },
        ],
      },
    });
    const abort = new AbortController();

    if (mode === 'consent') {
      void ui.requestConsent({
        trigger: { source: 'user' },
        maxDurationMs: 180_000,
        signal: abort.signal,
      });
    } else if (mode === 'recording') {
      controller.recording = ui.showIndicator({
        startedAt: FIXED_NOW - 73_000,
        maxDurationMs: 180_000,
        stop: () => controller.stop(),
      });
      controller.stop = () => {
        controller.recording?.();
        controller.recording = undefined;
        controller.uploading = ui.showUploading?.();
      };
    } else if (mode === 'uploading') {
      controller.uploading = ui.showUploading?.();
    } else if (mode === 'success') {
      ui.showResult?.({
        status: 'uploaded',
        receipt: {
          replayId: 'demo-42',
          reference: 'SUP-2042',
          url: 'https://replays.example/replay/demo-42',
        },
      });
    } else {
      ui.showResult?.({
        status: 'error',
        error: Object.assign(new Error('Fixture transport error'), {
          userMessage: "Couldn't send recording",
          link: { label: 'Check connection', url: 'https://status.example/support' },
        }),
        retry: () => {},
      });
    }

    return () => {
      abort.abort();
      controller.recording?.();
      controller.uploading?.();
      ui.dismiss?.();
      Date.now = originalNow;
    };
  }, [mode, theme, compact]);

  return (
    <div
      data-recorder-stage
      style={{
        width: compact ? 320 : '100%',
        minHeight: compact ? 640 : '100vh',
        overflow: 'hidden',
        transform: compact ? 'translateZ(0)' : undefined,
      }}
    >
      <RecorderHost status={mode === 'consent' ? 'idle' : mode} />
    </div>
  );
}

function makeStubController() {
  return {
    recording: undefined as (() => void) | undefined,
    uploading: undefined as (() => void) | undefined,
    stop() {},
  };
}
