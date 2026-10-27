import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createRecorder } from '../recorder.ts';
import { createDeferredUi } from '../deferred-ui.ts';
import { createRecorderStore } from '../store.ts';
import { createRecordingTimer, recordingTimer, type TimerOptions } from '../timer.ts';
import { createAnnouncer } from '../kit/index.ts';
import type { Recorder, RecorderOptions, RecorderState } from '../types.ts';

const Context = createContext<
  | {
      recorder: Recorder;
      store: ReturnType<typeof createRecorderStore>;
      deferred?: ReturnType<typeof createDeferredUi>;
    }
  | undefined
>(undefined);

export function RecorderProvider(props: {
  recorder?: Recorder;
  options?: RecorderOptions;
  deferred?: ReturnType<typeof createDeferredUi>;
  children?: ReactNode;
}) {
  const [value] = useState(() => {
    if (props.recorder)
      return {
        recorder: props.recorder,
        store: createRecorderStore(props.recorder),
        ...(props.deferred ? { deferred: props.deferred } : {}),
      };
    if (!props.options) throw new Error('RecorderProvider requires options or recorder');
    const deferred = createDeferredUi();
    const recorder = createRecorder({ ...props.options, ui: props.options.ui ?? deferred.ui });
    return { recorder, store: createRecorderStore(recorder), ...(!props.options.ui ? { deferred } : {}) };
  });
  const lifetime = useRef(0);
  useEffect(() => {
    const token = ++lifetime.current;
    return () => {
      queueMicrotask(() => {
        // oxlint-disable-next-line react/exhaustive-deps -- generation counter deliberately observes the next StrictMode setup.
        if (lifetime.current === token && !props.recorder) value.recorder.destroy();
      });
    };
  }, [props.recorder, value]);
  return createElement(Context.Provider, { value }, props.children);
}
function useValue() {
  const value = useContext(Context);
  if (!value) throw new Error('Use RecorderProvider');
  return value;
}
export const useRecorder = () => useValue().recorder;
export const useRecorderActions = () => useValue().store.actions;
export function useRecorderState<T = RecorderState>(
  selector: (state: RecorderState) => T = (state) => state as T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const { recorder } = useValue();
  const cache = useRef<{ value: T } | undefined>(undefined);
  const get = () => {
    const value = selector(recorder.getState());
    if (!cache.current || !isEqual(cache.current.value, value)) cache.current = { value };
    return cache.current.value;
  };
  return useSyncExternalStore(recorder.subscribe, get, get);
}
const noopSubscribe = () => () => {};
const empty = () => undefined;
export function useRecorderPrompt() {
  const pending = useValue().deferred?.pending;
  return useSyncExternalStore(pending?.subscribe ?? noopSubscribe, pending?.get ?? empty, empty);
}
function timerSource(recorder: Recorder, config: TimerOptions) {
  let snapshot = recordingTimer(recorder.getState(), config.now?.() ?? Date.now(), config);
  return {
    get: () => snapshot,
    subscribe(listener: () => void) {
      const timer = createRecordingTimer(recorder, config);
      snapshot = timer.get();
      const off = timer.subscribe(() => {
        snapshot = timer.get();
        listener();
      });
      return () => {
        off();
        timer.dispose();
      };
    },
  };
}
export function useRecordingTimer(options: TimerOptions = {}) {
  const recorder = useRecorder();
  const { warnAtMs, finalAtMs, now } = options;
  const store = useMemo(
    () =>
      timerSource(recorder, {
        ...(warnAtMs !== undefined ? { warnAtMs } : {}),
        ...(finalAtMs !== undefined ? { finalAtMs } : {}),
        ...(now ? { now } : {}),
      }),
    [recorder, warnAtMs, finalAtMs, now],
  );
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
export function useStopAttestation(): (element: HTMLElement | null) => void {
  const recorder = useRecorder();
  const release = useRef<(() => void) | undefined>(undefined);
  return useCallback(
    (element) => {
      release.current?.();
      release.current = undefined;
      if (element) release.current = recorder.attestStop(element);
    },
    [recorder],
  );
}
export function useAnnouncer() {
  const announcer = useRef<ReturnType<typeof createAnnouncer> | undefined>(undefined);
  useEffect(
    () => () => {
      announcer.current?.dispose();
      announcer.current = undefined;
    },
    [],
  );
  return useCallback((text: string, politeness?: 'polite' | 'assertive') => {
    announcer.current ??= createAnnouncer();
    announcer.current.say(text, politeness);
  }, []);
}
export function RecorderRegion(props: { children?: ReactNode; className?: string }) {
  return createElement('div', { 'data-recorder-ui': '', ...props });
}
