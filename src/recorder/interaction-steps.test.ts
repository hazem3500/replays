// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RawStep } from './bundle.ts';
import { resolveCapture } from './capture-options.ts';
import { captureInteractionSteps } from './interaction-steps.ts';
import { recorderPrivacy } from './recorder-privacy.ts';
import { must } from './testing.ts';
import { assertReplayBundle } from '../shared/replay.ts';
import { buildReplayBundle } from './bundle.ts';
import { createRecorder } from './recorder.ts';
import { createFakeRrweb, createFakeTransport } from './testing/fakes.ts';
import type { RecorderPrivacyOptions } from './types.ts';

const cleanups: Array<() => void> = [];
const originalUrl = location.href;

function capture(options: RecorderPrivacyOptions = {}) {
  const steps: RawStep[] = [];
  const privacy = recorderPrivacy(options, resolveCapture({ privacy: options }));
  const stop = captureInteractionSteps(privacy, (step) => steps.push(step));
  cleanups.push(stop);
  return { steps, stop };
}

function button(text: string) {
  const control = document.createElement('button');
  control.textContent = text;
  document.body.append(control);
  return control;
}

function resetCapture() {
  for (const stop of cleanups.splice(0)) stop();
  history.replaceState(null, '', originalUrl);
  document.body.replaceChildren();
  vi.useRealTimers();
}

describe('browser interaction privacy', () => {
  afterEach(resetCapture);

  it('uses generic masked labels and retains neither selectors nor destination query values', () => {
    const { steps } = capture();
    const link = document.createElement('a');
    link.href = '/projects?search=private-name#access_token=secret';
    link.textContent = 'Secret project';
    link.id = 'private-user-id';
    document.body.append(link);
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    history.pushState(null, '', '/projects?search=private-name#access_token=secret');
    expect(steps.map(({ kind, label }) => ({ kind, label }))).toEqual([
      { kind: 'click', label: 'Opened Projects' },
    ]);
    expect(JSON.stringify(steps)).not.toMatch(/private|Secret|access_token|selector|url/);
  });

  it('reads only approved control text and excludes blocked descendants', () => {
    const { steps } = capture({ unmaskTextSelector: '[data-public]', maskTextSelector: '[data-private]', blockSelector: '[data-blocked]' });
    const control = button('');
    control.setAttribute('data-public', '');
    control.innerHTML = 'Create project <span data-blocked>hidden customer</span>';
    control.click();
    expect(steps[0]?.label).toBe('Clicked “Create project”');
  });

  it('omits masked descendants and navigation query text from readable button labels', () => {
    const { steps } = capture({ maskAllText: false, maskTextSelector: '[data-private]' });
    const control = button('');
    control.innerHTML = 'Open https://example.test/projects?search=private-name#secret <span data-private>private customer</span>';
    control.click();
    expect(steps[0]?.label).toBe('Clicked “Open https://example.test/projects”');
  });

  it('never reads input values, form data or input labels when a form is submitted', () => {
    const { steps } = capture({ sanitize: false });
    const form = document.createElement('form');
    form.innerHTML = '<input value="private-email@example.com" aria-label="Secret customer"><input type="password" value="secret">';
    document.body.append(form);
    must(form.querySelector('input')).click();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(steps.map((step) => step.label)).toEqual(['Clicked field', 'Requested form submission']);
    expect(JSON.stringify(steps)).not.toMatch(/private-email|Secret customer|password|secret/);
  });

  it('excludes recorder UI and blocked controls even through an open shadow root', () => {
    const { steps } = capture({ maskAllText: false });
    const host = document.createElement('div');
    host.setAttribute('data-recorder-ui', '');
    const root = host.attachShadow({ mode: 'open' });
    const control = document.createElement('button');
    control.textContent = 'Stop recording';
    root.append(control);
    document.body.append(host);
    control.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    const blocked = button('Private action');
    blocked.setAttribute('data-recorder-block', '');
    blocked.click();
    expect(steps).toEqual([]);
  });
});

describe('bounded interaction history', () => {
  afterEach(resetCapture);

  it('groups rapid repeats and bounds the interaction list', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { steps } = capture();
    const control = button('Save');
    control.click();
    control.click();
    expect(steps).toHaveLength(1);
    for (let index = 0; index < 510; index++) {
      vi.setSystemTime(1400 + index * 400);
      control.click();
    }
    expect(steps).toHaveLength(500);
    const bundle = buildReplayBundle({
      title: 'Capped steps',
      events: [
        { type: 4, timestamp: 1000, data: { href: 'https://example.test', width: 800, height: 600 } },
        { type: 2, timestamp: 300000, data: { node: {} } },
      ],
      steps: [{ at: 1000, kind: 'start', label: 'Recording started' }, ...steps, { at: 300000, kind: 'stop', label: 'Recording stopped' }],
      console: [],
      network: [],
    });
    expect(bundle.steps).toHaveLength(502);
    expect(() => assertReplayBundle(bundle)).not.toThrow();
  });
});

describe('navigation subscription lifecycle', () => {
  afterEach(resetCapture);

  it('restores navigation hooks and removes event listeners when capture stops', () => {
    const push = Reflect.get(history, 'pushState');
    const replace = Reflect.get(history, 'replaceState');
    const { steps, stop } = capture();
    const control = button('Save');
    control.click();
    stop();
    control.click();
    history.pushState(null, '', '/after-recording');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(steps).toHaveLength(1);
    expect(history).toHaveProperty('pushState', push);
    expect(history).toHaveProperty('replaceState', replace);
  });

  it('releases the shared history hooks after concurrent captures stop in creation order', () => {
    const push = Reflect.get(history, 'pushState');
    const replace = Reflect.get(history, 'replaceState');
    const first = capture();
    const second = capture();
    first.stop();
    history.pushState(null, '', '/second-recording');
    expect(first.steps).toEqual([]);
    expect(second.steps.map((step) => step.kind)).toEqual(['navigate']);
    second.stop();
    expect(history).toHaveProperty('pushState', push);
    expect(history).toHaveProperty('replaceState', replace);
    history.pushState(null, '', '/no-recording');
    expect(second.steps).toHaveLength(1);
  });

  it('preserves a later host history wrapper when the last recorder stops', () => {
    const original = Reflect.get(history, 'pushState');
    const { steps, stop } = capture();
    const wrapped = Reflect.get(history, 'pushState');
    const host: History['pushState'] = function (this: History, ...args) {
      wrapped.apply(this, args);
    };
    history.pushState = host;
    try {
      stop();
      expect(history).toHaveProperty('pushState', host);
      history.pushState(null, '', '/host-owned');
      expect(steps).toEqual([]);
    } finally {
      history.pushState = original;
    }
  });
});

describe('recorder session interactions', () => {
  afterEach(resetCapture);

  it('wires fresh steps for each real recorder session without retaining discarded actions', async () => {
    const rrweb = createFakeRrweb();
    const transport = createFakeTransport();
    const recorder = createRecorder({ upload: transport.upload, loadRrweb: rrweb.load, activation: () => true });
    cleanups.push(() => recorder.destroy());
    await recorder.start({ consent: true });
    button('Discarded action').click();
    recorder.discard();
    await recorder.start({ consent: true });
    button('Kept action').click();
    rrweb.emit({ type: 3, timestamp: Date.now() + 1000, data: {} });
    recorder.stop();
    await recorder.upload({ confirmed: true });
    expect(transport.reports[0]?.bundle.steps.map((step) => step.kind)).toEqual(['start', 'click', 'stop']);
    expect(transport.reports[0]?.bundle.steps.every((step) => step.at >= 0)).toBe(true);
  });
});
