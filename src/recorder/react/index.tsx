import { createContext, createElement, useContext, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createRecorder } from '../recorder.ts';
import { createDeferredUi } from '../deferred-ui.ts';
import type { PendingPrompt } from '../deferred-ui.ts';
import { createRecorderStore } from '../store.ts';
import type { TimerOptions, TimerSnapshot } from '../timer.ts';
import { useRecorderLifetime, useStopControl, useLiveAnnouncements } from './hooks/lifecycle.ts';
import { useTimerSnapshot } from './hooks/timer.ts';
import type { Recorder, RecorderOptions, RecorderState } from '../types.ts';

type ContextValue = { recorder: Recorder; store: ReturnType<typeof createRecorderStore>; deferred?: ReturnType<typeof createDeferredUi> };
type ProviderProps = {
  recorder?: Recorder;
  options?: RecorderOptions;
  deferred?: ReturnType<typeof createDeferredUi>;
  children?: ReactNode;
};
const Context = createContext<ContextValue | undefined>(undefined);
function providerValue(props: ProviderProps): ContextValue {
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
}
export function RecorderProvider(props: ProviderProps): ReactElement {
  const [value] = useState(() => providerValue(props));
  useRecorderLifetime(value.recorder, !props.recorder);
  return createElement(Context.Provider, { value }, props.children);
}
function useValue(): ContextValue {
  const value = useContext(Context);
  if (!value) throw new Error('Use RecorderProvider');
  return value;
}
export const useRecorder = (): Recorder => useValue().recorder;
export const useRecorderActions = (): ReturnType<typeof createRecorderStore>['actions'] => useValue().store.actions;
export function useRecorderState<T = RecorderState>(selector?: (state: RecorderState) => T, isEqual?: (a: T, b: T) => boolean): T;
export function useRecorderState<T>(
  selector?: (state: RecorderState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T | RecorderState {
  const { recorder, store } = useValue();
  const cache = useRef<{ kind: 'selected'; value: T } | { kind: 'state'; value: RecorderState } | undefined>(undefined);
  const get = () => {
    const state = recorder.getState();
    if (!selector) return state;
    const value = selector(state);
    if (cache.current?.kind !== 'selected' || !isEqual(cache.current.value, value)) cache.current = { kind: 'selected', value };
    return cache.current.value;
  };
  return useSyncExternalStore(store.subscribe, get, get);
}
const noopSubscribe = (): (() => void) => () => {};
function empty(): undefined {
  return;
}
export function useRecorderPrompt(): PendingPrompt | undefined {
  const pending = useValue().deferred?.pending;
  return useSyncExternalStore(pending?.subscribe ?? noopSubscribe, pending?.get ?? empty, empty);
}
export function useRecordingTimer(options: TimerOptions = {}): TimerSnapshot | undefined {
  return useTimerSnapshot(useRecorder(), options);
}
export function useStopAttestation(): (element: HTMLElement | null) => void {
  return useStopControl(useRecorder());
}
export function useAnnouncer(): (text: string, politeness?: 'polite' | 'assertive') => void {
  return useLiveAnnouncements();
}
export function RecorderRegion(props: { children?: ReactNode; className?: string }): ReactElement {
  return createElement('div', { 'data-recorder-ui': '', ...props });
}
