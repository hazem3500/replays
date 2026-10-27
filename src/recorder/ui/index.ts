import { createRecorder } from '../recorder.ts';
import { createDefaultUi, type DefaultUiOptions } from '../default-ui.ts';
import type { Recorder, RecorderOptions, RecorderUi } from '../types.ts';
export * from '../default-ui.ts';

/** One-line built-in consent → indicator → review → result flow. */
export function createGuidedRecorder(options: Omit<RecorderOptions, 'ui'> & { ui?: RecorderUi | DefaultUiOptions }): Recorder {
  const { ui, ...core } = options;
  return createRecorder({
    ...core,
    ui:
      ui && 'requestConsent' in ui
        ? ui
        : createDefaultUi({
            privacyMode: options.privacy?.sanitize === false ? 'visible' : 'masked',
            ...ui,
          }),
  });
}
function assertComplete(ui: Partial<RecorderUi>): asserts ui is RecorderUi {
  for (const key of ['requestConsent', 'showIndicator', 'confirmUpload'] as const) {
    if (typeof ui[key] !== 'function') throw new Error(`Recorder UI missing ${key}`);
  }
}
export function composeUi(...parts: Partial<RecorderUi>[]): RecorderUi {
  const ui: Partial<RecorderUi> = {};
  for (const part of parts) Object.assign(ui, part);
  assertComplete(ui);
  const lifecycleParts: { dismiss?: () => void }[] = parts;
  const dismissers = [...new Set(lifecycleParts.flatMap((part) => (part.dismiss ? [part.dismiss] : [])))];
  if (dismissers.length)
    ui.dismiss = () => {
      for (const dismiss of dismissers.toReversed()) dismiss();
    };
  return ui;
}
export function consentDialog(options?: DefaultUiOptions): Pick<RecorderUi, 'requestConsent' | 'dismiss'> {
  const ui = createDefaultUi(options);
  return { requestConsent: (context) => ui.requestConsent(context), dismiss: () => ui.dismiss() };
}
export function recordingIndicator(options?: DefaultUiOptions): Pick<RecorderUi, 'showIndicator' | 'dismiss'> {
  const ui = createDefaultUi(options);
  return { showIndicator: (context) => ui.showIndicator(context), dismiss: () => ui.dismiss() };
}
export function reviewDialog(options?: DefaultUiOptions): Pick<RecorderUi, 'confirmUpload' | 'dismiss'> {
  const ui = createDefaultUi(options);
  return { confirmUpload: (context) => ui.confirmUpload(context), dismiss: () => ui.dismiss() };
}
export function resultToast(options?: DefaultUiOptions): Pick<RecorderUi, 'showUploading' | 'showResult' | 'dismiss'> {
  const ui = createDefaultUi(options);
  return { showUploading: () => ui.showUploading(), showResult: (result) => ui.showResult(result), dismiss: () => ui.dismiss() };
}
