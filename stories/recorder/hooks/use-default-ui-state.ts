import { useEffect } from 'react';
import { recorderChoices } from '../../../src/recorder/recorder-choices.ts';
import { settingsBuilder } from '../../../src/recorder/recorder-settings.ts';
import type { RecorderOptions } from '../../../src/recorder/types.ts';
import { createDefaultUi, type DefaultUiOptions } from '../../../src/recorder/ui/index.ts';

export type DefaultUiState =
  | 'options'
  | 'options-capped'
  | 'consent'
  | 'recording'
  | 'final-seconds'
  | 'review'
  | 'uploading'
  | 'sent'
  | 'failed';

const CHOICES: RecorderOptions['choices'] = {
  privacy: ['visible', 'inputs-masked', 'interface-visible', 'masked'],
  // why: shaped like a deployment's configured profiles, as a host would pass them from GET /api/config.
  profiles: [
    { id: 'triage', label: 'Triage', description: 'A bug to reproduce and fix' },
    { id: 'performance', label: 'Performance', description: 'Slow pages, with vitals and requests' },
    { id: 'design-review', label: 'Design review', description: 'Layout and visual feedback' },
    { id: 'walkthrough', label: 'Walkthrough', description: 'A guided tour of a flow' },
    { id: 'support', label: 'Support', description: 'A customer issue for the support team' },
  ],
  remember: false,
};
/** An internal host that allows everything, and one that keeps media blocked, offering the same modes through the real core cap. */
const HOSTS: Record<'options' | 'options-capped', Pick<RecorderOptions, 'privacy' | 'choices'>> = {
  options: { privacy: { sanitize: false, blockMedia: false }, choices: CHOICES },
  'options-capped': { privacy: { sanitize: false }, choices: CHOICES },
};

const FIXED_NOW = new Date('2026-10-27T12:00:00.000Z').getTime();

type Shown = { hide?: () => void; abort: AbortController };

function show(ui: ReturnType<typeof createDefaultUi>, state: DefaultUiState): Shown {
  const abort = new AbortController();
  if (state === 'options' || state === 'options-capped') {
    const offer = recorderChoices(HOSTS[state], settingsBuilder(HOSTS[state])).offer((privacy) => privacy.facts(180_000, true));
    if (offer) void ui.chooseOptions({ trigger: { source: 'user' }, offer, signal: abort.signal });
    return { abort };
  }
  if (state === 'consent') {
    void ui.requestConsent({ trigger: { source: 'user' }, maxDurationMs: 180_000, signal: abort.signal });
    return { abort };
  }
  if (state === 'review') {
    const summary = {
      durationMs: 73_000,
      eventCount: 812,
      consoleErrors: 0,
      failedRequests: 0,
      approxBytes: 1_480_000,
      stopReason: 'user' as const,
    };
    void ui.confirmUpload({ summary, signal: abort.signal });
    return { abort };
  }
  if (state === 'recording' || state === 'final-seconds') {
    const shown: Shown = { abort };
    const hideIndicator = ui.showIndicator({
      startedAt: FIXED_NOW - (state === 'recording' ? 73_000 : 174_000),
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
