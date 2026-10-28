import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { RecorderProvider } from './react/index.tsx';
import { createRecorder } from './recorder.ts';
import { must } from './testing.ts';
import { createFakeRrweb, createFakeTransport, queryDeep, testRecorderUi } from './testing/index.ts';
import { referenceFactory } from '../../examples/recorder-shadcn/test/ui-fixture.tsx';
import { RecorderUi as ReferenceUi } from '../../examples/recorder-shadcn/src/RecorderUi.tsx';

async function runReact(action: () => void): Promise<void> {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
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
function mountedRoot() {
  const container = document.createElement('div');
  document.body.append(container);
  return { container, root: createRoot(container) };
}
async function clickAction(action: string): Promise<void> {
  await runReact(() => {
    must(queryDeep<HTMLButtonElement>(`[data-recorder-action="${action}"]`), action).click();
  });
}
async function ownedStrictMode() {
  const rrweb = createFakeRrweb();
  const transport = createFakeTransport();
  const { container, root } = mountedRoot();
  await runReact(() =>
    root.render(
      <StrictMode>
        <RecorderProvider options={{ upload: transport.upload, loadRrweb: rrweb.load, activation: () => true }}>
          <ReferenceUi />
        </RecorderProvider>
      </StrictMode>,
    ),
  );
  await runReact(() => {
    must(container.querySelector('button'), 'Record').click();
  });
  await clickAction('consent-accept');
  expect(rrweb.loads).toBe(1);
  await runReact(() => root.unmount());
  await Promise.resolve();
  expect(rrweb.stopped).toBe(1);
}
async function externalOwnershipAndSsr() {
  const transport = createFakeTransport();
  const recorder = createRecorder({ upload: transport.upload, loadRrweb: createFakeRrweb().load, activation: () => true });
  expect(
    renderToString(
      <RecorderProvider recorder={recorder}>
        <div>App</div>
      </RecorderProvider>,
    ),
  ).toContain('App');
  const { root } = mountedRoot();
  await runReact(() => root.render(<RecorderProvider recorder={recorder} />));
  await runReact(() => root.unmount());
  await recorder.start({ consent: true });
  expect(recorder.getState().status).toBe('recording');
  recorder.destroy();
}
async function realProviderFlow() {
  const transport = createFakeTransport();
  const rrweb = createFakeRrweb();
  const { container, root } = mountedRoot();
  await runReact(() =>
    root.render(
      <RecorderProvider options={{ upload: transport.upload, loadRrweb: rrweb.load, strictInvariants: true, activation: () => true }}>
        <ReferenceUi />
      </RecorderProvider>,
    ),
  );
  await runReact(() => {
    must(container.querySelector('button'), 'Record').click();
  });
  expect(rrweb.loads).toBe(0);
  await clickAction('consent-accept');
  expect(rrweb.loads).toBe(1);
  await clickAction('stop');
  expect(transport.reports).toHaveLength(0);
  await clickAction('send');
  expect(transport.reports).toHaveLength(1);
  await runReact(() => root.unmount());
}
describe('React recorder lifecycle', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });
  it('survives StrictMode replay and destroys its owned recorder after unmount', ownedStrictMode);
  it('leaves an externally owned recorder alive and renders during SSR', externalOwnershipAndSsr);
  it('uses provider-owned deferred decisions in a real recording flow', realProviderFlow);
});
