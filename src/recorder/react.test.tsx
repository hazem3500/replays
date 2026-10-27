import { StrictMode, act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { RecorderProvider, useRecorder } from './react/index.tsx';
import { createRecorder } from './recorder.ts';
import { createFakeRrweb, createFakeTransport, queryDeep, testRecorderUi } from './testing/index.ts';
import { referenceFactory } from '../../examples/recorder-shadcn/test/ui-fixture.tsx';
import { RecorderUi as ReferenceUi } from '../../examples/recorder-shadcn/src/RecorderUi.tsx';
import type { Recorder } from './types.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => {
  document.body.replaceChildren();
});

/** Bridge imperative contract contexts into the same deferred React surfaces used by the app. */
testRecorderUi(
  'React reference UI contract',
  referenceFactory,
  { describe, it },
  {
    render: async (flush) => {
      await act(flush);
    },
  },
);

describe('React recorder lifecycle', () => {
  it('survives StrictMode replay and destroys its owned recorder after unmount', async () => {
    const rrweb = createFakeRrweb();
    const transport = createFakeTransport();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let recorder: Recorder | undefined;
    function Probe() {
      const value = useRecorder();
      useEffect(() => {
        recorder = value;
      }, [value]);
      return null;
    }
    await act(async () => {
      root.render(
        <StrictMode>
          <RecorderProvider options={{ upload: transport.upload, loadRrweb: rrweb.load, strictInvariants: false, activation: () => true }}>
            <Probe />
          </RecorderProvider>
        </StrictMode>,
      );
    });
    await act(async () => {
      await recorder!.start({ consent: true });
    });
    expect(recorder!.getState().status).toBe('recording');
    await act(async () => {
      root.unmount();
    });
    await Promise.resolve();
    expect(rrweb.stopped).toBe(1);
    await expect(recorder!.start({ consent: true })).rejects.toThrow(/destroyed/);
  });
  it('leaves an externally owned recorder alive and renders during SSR', async () => {
    const transport = createFakeTransport();
    const recorder = createRecorder({ upload: transport.upload, loadRrweb: createFakeRrweb().load, activation: () => true });
    expect(
      renderToString(
        <RecorderProvider recorder={recorder}>
          <div>App</div>
        </RecorderProvider>,
      ),
    ).toContain('App');
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(<RecorderProvider recorder={recorder} />);
    });
    await act(async () => root.unmount());
    await recorder.start({ consent: true });
    expect(recorder.getState().status).toBe('recording');
    recorder.destroy();
  });
  it('uses provider-owned deferred decisions in a real recording flow', async () => {
    const transport = createFakeTransport();
    const rrweb = createFakeRrweb();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <RecorderProvider options={{ upload: transport.upload, loadRrweb: rrweb.load, strictInvariants: true, activation: () => true }}>
          <ReferenceUi />
        </RecorderProvider>,
      ),
    );
    await act(async () => {
      container.querySelector('button')!.click();
    });
    expect(rrweb.loads).toBe(0);
    await act(async () => {
      queryDeep<HTMLButtonElement>('[data-recorder-action="consent-accept"]')!.click();
    });
    expect(rrweb.loads).toBe(1);
    await act(async () => {
      queryDeep<HTMLButtonElement>('[data-recorder-action="stop"]')!.click();
    });
    expect(transport.reports).toHaveLength(0);
    await act(async () => {
      queryDeep<HTMLButtonElement>('[data-recorder-action="send"]')!.click();
    });
    expect(transport.reports).toHaveLength(1);
    await act(async () => root.unmount());
  });
});
