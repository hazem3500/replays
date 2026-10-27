import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RecorderProvider } from '@hazem3500/replays/recorder/react';
import { createDeferredUi } from '@hazem3500/replays/recorder';
import type { Recorder, RecorderState, RecorderUi } from '@hazem3500/replays/recorder';
import { RecorderUi as ReferenceUi } from '../src/RecorderUi.tsx';

function actNow<T>(run: () => T): T {
  const result: { value?: T } = {};
  act(() => {
    result.value = run();
  });
  if (!('value' in result)) throw new Error('React did not run the fixture action');
  return result.value;
}
function absent(): undefined {
  return;
}
function referenceController(deferred: ReturnType<typeof createDeferredUi>, dismiss: () => void) {
  const listeners = new Set<(state: RecorderState) => void>();
  let state: RecorderState = { status: 'idle' };
  let indicator: Parameters<RecorderUi['showIndicator']>[0] | undefined;
  let retry: (() => void) | undefined;
  const set = (next: RecorderState) =>
    actNow(() => {
      state = next;
      for (const fn of listeners) fn(next);
    });
  const recorder: Recorder = {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    respond(decision) {
      actNow(() => deferred.ui.respond?.(decision));
    },
    request: () => Promise.resolve(absent()),
    start: () => Promise.resolve(),
    stop() {
      indicator?.stop();
      return absent();
    },
    upload: () => Promise.resolve({ replayId: 'test' }),
    retryUpload() {
      retry?.();
      return Promise.resolve({ replayId: 'test' });
    },
    attestStop(element) {
      return indicator?.attestStop?.(element) ?? (() => {});
    },
    getProgress: absent,
    setReportContext() {},
    discard: dismiss,
    destroy: dismiss,
  };
  return {
    recorder,
    set,
    indicator(context: Parameters<RecorderUi['showIndicator']>[0]) {
      indicator = context;
    },
    result(result: Parameters<NonNullable<RecorderUi['showResult']>>[0]) {
      if (result.status === 'uploaded') set({ status: 'uploaded', receipt: result.receipt });
      else {
        retry = result.retry;
        set({ status: 'error', phase: 'upload', error: result.error });
      }
    },
  };
}
export function referenceFactory(): RecorderUi {
  const deferred = createDeferredUi();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let disposed = false;
  const dismiss = () => {
    if (disposed) return;
    disposed = true;
    actNow(() => {
      deferred.ui.dismiss?.();
      root.unmount();
    });
    container.remove();
  };
  const controller = referenceController(deferred, dismiss);
  const ui: RecorderUi = {
    requestConsent(context) {
      controller.set({ status: 'consent', trigger: context.trigger });
      return actNow(() => deferred.ui.requestConsent(context));
    },
    showIndicator(context) {
      controller.indicator(context);
      controller.set({
        status: 'recording',
        trigger: { source: 'user' },
        startedAt: context.startedAt,
        maxDurationMs: context.maxDurationMs,
      });
      const hide = actNow(() => deferred.ui.showIndicator(context));
      return () => {
        actNow(hide);
        controller.set({ status: 'idle' });
      };
    },
    confirmUpload(context) {
      controller.set({ status: 'review', summary: context.summary });
      return actNow(() => deferred.ui.confirmUpload(context));
    },
    showResult(result) {
      controller.result(result);
    },
    dismiss,
  };
  actNow(() =>
    root.render(
      <RecorderProvider recorder={controller.recorder} deferred={deferred}>
        <ReferenceUi />
      </RecorderProvider>,
    ),
  );
  return ui;
}
