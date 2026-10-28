import { useEffect } from 'react';
import { createDefaultUi, type DefaultUiOptions } from '../../../src/recorder/ui/index.ts';

export type DefaultUiState = 'consent' | 'recording' | 'uploading' | 'sent' | 'failed';

export const FIXED_NOW = new Date('2026-10-27T12:00:00.000Z').getTime();

type Shown = { hide?: () => void; abort: AbortController };

function show(ui: ReturnType<typeof createDefaultUi>, state: DefaultUiState): Shown {
  const abort = new AbortController();
  if (state === 'consent') {
    void ui.requestConsent({ trigger: { source: 'user' }, maxDurationMs: 180_000, signal: abort.signal });
    return { abort };
  }
  if (state === 'recording') {
    const shown: Shown = { abort };
    const hideIndicator = ui.showIndicator({
      startedAt: FIXED_NOW - 73_000,
      maxDurationMs: 180_000,
      stop: () => {
        hideIndicator();
        shown.hide = ui.showUploading();
      },
    });
    shown.hide = hideIndicator;
    return shown;
  }
  if (state === 'uploading') return { abort, hide: ui.showUploading() };
  if (state === 'sent') {
    ui.showResult({
      status: 'uploaded',
      receipt: { replayId: 'demo-42', reference: 'SUP-2042', url: 'https://replays.example/r/demo-42' },
    });
    return { abort };
  }
  // invariant: no userMessage or link, so the story shows the recorder's own failure copy.
  ui.showResult({ status: 'error', error: new Error('Upload failed with HTTP 503'), retry: () => {} });
  return { abort };
}

/**
 * Drives the real framework-free default UI into one state, without a recorder, rrweb or network. `Date.now` is pinned
 * while mounted so the elapsed timer reads the same on every run.
 */
export function useDefaultUiState(state: DefaultUiState, options: DefaultUiOptions) {
  useEffect(() => {
    const realNow = Date.now;
    Date.now = () => FIXED_NOW;
    const ui = createDefaultUi(options);
    const shown = show(ui, state);
    return () => {
      shown.abort.abort();
      shown.hide?.();
      ui.dismiss();
      Date.now = realNow;
    };
    // oxlint-disable-next-line react/exhaustive-deps -- why: options is rebuilt per render from the same story args; state and theme identify the surface.
  }, [state, options.theme]);
}
