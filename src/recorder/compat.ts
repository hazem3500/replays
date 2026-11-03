import type { DefaultUiOptions } from './default-ui.ts';
import type { RecorderUi } from './types.ts';
/** @deprecated Import the synchronous factory from /recorder/ui. Compatibility lasts two minors / 90 days. */
export function createDefaultUi(options?: DefaultUiOptions): RecorderUi {
  let pending: Promise<RecorderUi> | undefined;
  let generation = 0;
  const get = () => (pending ??= import('./ui/index.ts').then((module) => module.createDefaultUi(options)));
  return {
    requestConsent: async (context) => (await get()).requestConsent(context),
    chooseOptions: async (context) => (await get()).chooseOptions?.(context),
    confirmUpload: async (context) => (await get()).confirmUpload(context),
    showIndicator(context) {
      let hide: (() => void) | undefined;
      let closed = false;
      const own = generation;
      void get().then((ui) => {
        if (!closed && own === generation) hide = ui.showIndicator(context);
      });
      return () => {
        closed = true;
        hide?.();
      };
    },
    showUploading() {
      let hide: (() => void) | undefined;
      let closed = false;
      const own = generation;
      void get().then((ui) => {
        if (!closed && own === generation) hide = ui.showUploading?.();
      });
      return () => {
        closed = true;
        hide?.();
      };
    },
    showResult(context) {
      const own = generation;
      void get().then((ui) => {
        if (own === generation) ui.showResult?.(context);
      });
    },
    dismiss() {
      generation++;
      if (pending) void pending.then((ui) => ui.dismiss?.());
    },
  };
}
