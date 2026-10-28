import { createRecorder, createTokenUpload, type Recorder, type RecorderState, type RecorderStatus } from '../../src/recorder/index.ts';
import { createDefaultUi } from '../../src/recorder/ui/index.ts';
import { UPLOAD_PATH } from './upload-endpoint.ts';

/** `http` posts with fetch (`createHttpUpload`); `token` posts with XHR (`createTokenUpload`), which reports byte progress. */
export type Transport = 'http' | 'token';

export type SessionOptions = {
  transport: Transport;
  theme: 'dark' | 'light';
  privacy: 'masked' | 'visible';
  consent: boolean;
  review: boolean;
};

export type TimelineEntry = { id: number; status: RecorderStatus };
export type SessionSnapshot = { state: RecorderState; timeline: readonly TimelineEntry[] };

const uploadFor = (transport: Transport) =>
  transport === 'token'
    ? createTokenUpload({ endpoint: UPLOAD_PATH, getToken: () => Promise.resolve('storybook-upload-token') })
    : { url: UPLOAD_PATH, headers: { 'x-replays-source': 'storybook' } };

/**
 * The production recorder and default UI, wired to the mocked endpoint. Nothing is stubbed in between: rrweb loads
 * through its real dynamic import, and uploads leave through fetch or XHR.
 */
export function createSession(options: SessionOptions) {
  const ui = createDefaultUi({
    theme: options.theme,
    privacyMode: options.privacy,
    completion: {
      actions: [{ id: 'open-replay', kind: 'link', label: 'Open replay', href: 'https://replays.example/r/storybook-demo-42' }],
    },
  });
  const recorder: Recorder = createRecorder({
    ui,
    upload: uploadFor(options.transport),
    prompts: { consent: options.consent, review: options.review },
    privacy: { sanitize: options.privacy === 'masked' },
    app: { name: 'Pinecone Goods', environment: 'local' },
    title: 'Storybook checkout report',
  });
  let snapshot: SessionSnapshot = { state: recorder.getState(), timeline: [{ id: 0, status: recorder.getState().status }] };
  const listeners = new Set<() => void>();
  const stopFollowing = recorder.subscribe((state) => {
    const last = snapshot.timeline.at(-1);
    const timeline =
      last?.status === state.status ? snapshot.timeline : [...snapshot.timeline, { id: snapshot.timeline.length, status: state.status }];
    snapshot = { state, timeline };
    for (const listener of listeners) listener();
  });
  return {
    recorder,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    destroy: () => {
      stopFollowing();
      recorder.destroy();
      ui.dismiss();
    },
  };
}

export type Session = ReturnType<typeof createSession>;
