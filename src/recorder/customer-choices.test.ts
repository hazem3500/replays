// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultRecorderMessages } from './messages.ts';
import { recorderChoices as choicesWith } from './recorder-choices.ts';
import { settingsBuilder } from './recorder-settings.ts';
import { createRecorder } from './recorder.ts';
import { must } from './testing.ts';
import { createFakeRrweb, createFakeTransport } from './testing/fakes.ts';
import type { PrivacyFacts, RecorderOptions, RecorderUi, RecordingChoice, RecordingChoiceOffer } from './types.ts';

type Host = Pick<RecorderOptions, 'choices' | 'privacy' | 'capture'>;
const recorderChoices = (host: Host) => choicesWith(host, settingsBuilder(host));
/** A customer host that allows every mode and request bodies. */
const CUSTOMER: Host = {
  privacy: { sanitize: false, maskAllText: false, blockMedia: false },
  capture: { network: 'bodies' },
  choices: { by: 'customer', privacy: ['visible', 'text-masked', 'masked'], networkBodies: true },
};
const offerOf = (host: Host) => must(recorderChoices(host).offer((privacy) => privacy.facts(180_000, true)));
const consentOf = (offer: RecordingChoiceOffer, mode: string) =>
  defaultRecorderMessages.consentPrivacy({
    mode: 'masked',
    privacy: { ...must(offer.privacy.find((entry) => entry.mode === mode)).facts, product: 'Acme' },
  });

/** The page a customer records: product navigation marked public, their own data, and form fields inside the marked nav. */
function page() {
  document.body.innerHTML = `
    <nav data-replay-public>
      <a id="reports">Reports</a>
      <input id="search" placeholder="Search">
      <textarea id="note">typed note</textarea>
      <select id="project"><option id="option">Ada's project</option></select>
      <div id="editable" contenteditable>typed entry</div>
    </nav>
    <p id="entry">Call with Ada about invoices</p>`;
  return (id: string) => must(document.getElementById(id), id);
}

describe('customer recording modes', () => {
  afterEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('lists the default first, then Fully masked, then each looser mode the host allows', () => {
    expect(offerOf(CUSTOMER).privacy.map((entry) => entry.mode)).toEqual(['interface-visible', 'masked', 'text-masked', 'visible']);
  });

  it('offers the default and Fully masked to a host with the default privacy', () => {
    expect(offerOf({ choices: { by: 'customer' } }).privacy.map((entry) => entry.mode)).toEqual(['interface-visible', 'masked']);
  });

  it('pre-selects the default on every recording and remembers nothing', () => {
    const choices = recorderChoices({
      ...CUSTOMER,
      choices: { ...CUSTOMER.choices, defaults: { privacy: 'visible', networkBodies: true } },
    });
    choices.accept({ privacy: 'visible', networkBodies: true });
    expect(localStorage.length).toBe(0);
    const offer = offerOf(CUSTOMER);
    expect(offer.initial).toEqual({ privacy: 'interface-visible', networkBodies: false });
    expect(offer.defaults).toEqual(offer.initial);
  });

  it('reduces a looser choice that did not come from the options step to the default', () => {
    const settings = recorderChoices(CUSTOMER).settings({ privacy: 'visible', networkBodies: true });
    expect(settings.privacy.facts(1, true).captures).toMatchObject({
      pageText: false,
      inputs: false,
      interfaceText: true,
      networkBodies: false,
    });
  });

  it('keeps a stricter choice that did not come from the options step', () => {
    const settings = recorderChoices(CUSTOMER).settings({ privacy: 'masked' });
    expect(settings.mode).toBe('masked');
    expect(settings.privacy.facts(1, true).captures).not.toHaveProperty('interfaceText');
  });

  it('applies a looser mode and bodies picked in the options step', () => {
    const choices = recorderChoices(CUSTOMER);
    const settings = choices.settings(choices.accept({ privacy: 'visible', networkBodies: true }));
    expect(settings.privacy.facts(1, true).captures).toMatchObject({ pageText: true, inputs: true, networkBodies: true });
  });

  it.each([
    ['allowed when the host captures bodies', CUSTOMER, true],
    ['disabled when the host captures headers only', { ...CUSTOMER, capture: { network: 'headers' } }, false],
  ] as const)('offers the body option %s, off by default', (_name, host, allowed) => {
    const choices = recorderChoices(host);
    expect(offerOf(host).networkBodies).toEqual({ allowed });
    expect(offerOf(host).initial.networkBodies).toBe(false);
    expect(choices.settings(choices.accept({ networkBodies: true })).capture.network).toBe(allowed ? 'bodies' : 'headers');
  });

  it('refuses a host selector that would unmask more than the public marker', () => {
    expect(() => recorderChoices({ ...CUSTOMER, privacy: { unmaskTextSelector: 'main' } })).toThrow('data-replay-public');
  });
});

const interfaceMode = () => recorderChoices(CUSTOMER).settings().privacy;
const isMaskFn = (value: unknown): value is (text: string, element: Element) => string => typeof value === 'function';
/** Whether `mode` masks `text` inside `element`, as rrweb calls it. */
function masks(mode: ReturnType<typeof interfaceMode>, text: string, element: Element): boolean {
  const maskTextFn = mode.rrwebOptions().maskTextFn;
  if (!isMaskFn(maskTextFn)) throw new Error('no maskTextFn');
  return maskTextFn(text, element) !== text;
}

describe('the public marker', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });
  it('keeps the text of marked product navigation visible', () => {
    const byId = page();
    expect(masks(interfaceMode(), 'Reports', byId('reports'))).toBe(false);
    expect(interfaceMode().textMasked(byId('reports'))).toBe(false);
  });

  it('masks unmarked user text', () => {
    const byId = page();
    expect(masks(interfaceMode(), 'Call with Ada about invoices', byId('entry'))).toBe(true);
    expect(interfaceMode().textMasked(byId('entry'))).toBe(true);
  });

  it.each(['search', 'note', 'project', 'option', 'editable'])('keeps %s inside a marked element masked', (id) => {
    const byId = page();
    expect(masks(interfaceMode(), 'typed', byId(id))).toBe(true);
    expect(interfaceMode().textMasked(byId(id))).toBe(true);
  });

  it('masks every input value, passwords and hidden fields included', () => {
    expect(interfaceMode().rrwebOptions()).toMatchObject({
      maskAllInputs: true,
      maskInputOptions: { password: true, hidden: true, text: true },
    });
  });

  it('hides the marked text too when the customer picks Fully masked', () => {
    const byId = page();
    const choices = recorderChoices(CUSTOMER);
    const fully = choices.settings(choices.accept({ privacy: 'masked' })).privacy;
    expect(masks(fully, 'Reports', byId('reports'))).toBe(true);
    expect(fully.textMasked(byId('reports'))).toBe(true);
  });
});

describe('customer consent copy', () => {
  it.each([
    ['interface-visible', "Your entries, names and typed text are hidden; Acme's menus and labels stay visible. Media is hidden."],
    ['masked', 'Page text, inputs and media are hidden.'],
    [
      'visible',
      'Visible page text is recorded. Typed values are recorded; passwords and hidden fields stay hidden. Media may be recorded.',
    ],
  ])('says exactly what %s records', (mode, recorded) => {
    expect(consentOf(offerOf(CUSTOMER), mode)).toBe(`${recorded} You review it before it is sent.`);
  });

  it('names request and response content when the customer includes it', () => {
    const choices = recorderChoices(CUSTOMER);
    const facts = choices.settings(choices.accept({ networkBodies: true })).privacy.facts(1, true);
    expect(defaultRecorderMessages.consentPrivacy({ mode: 'masked', privacy: facts })).toContain(
      'Request and response content is recorded with secrets removed.',
    );
  });
});

/** A customer recording through `request()`, the options step answered with `choice`. */
async function record(choice: RecordingChoice) {
  const rrweb = createFakeRrweb();
  const transport = createFakeTransport();
  const consents: (PrivacyFacts | undefined)[] = [];
  const reviews: (PrivacyFacts | undefined)[] = [];
  let stop: (() => void) | undefined;
  const ui: RecorderUi = {
    chooseOptions: () => Promise.resolve(choice),
    requestConsent: ({ privacy }) => {
      consents.push(privacy);
      return Promise.resolve(true);
    },
    showIndicator: (context) => {
      stop = context.stop;
      return () => {};
    },
    confirmUpload: ({ privacy }) => {
      reviews.push(privacy);
      return Promise.resolve({ confirmed: true });
    },
  };
  const recorder = createRecorder({
    upload: transport.upload,
    loadRrweb: rrweb.load,
    activation: () => true,
    ui,
    app: { name: 'Acme' },
    ...CUSTOMER,
  });
  const done = recorder.request();
  await vi.waitFor(() => expect(recorder.getState().status).toBe('recording'));
  rrweb.emit({ type: 3, timestamp: Date.now() + 1_000, data: {} });
  stop?.();
  await done;
  return { bundle: must(transport.reports[0]).bundle, consents, reviews };
}

describe('customer recording claim', () => {
  it('records the default mode in meta.captured.choice', async () => {
    const { bundle } = await record({});
    expect(bundle.meta.captured?.choice).toEqual({
      by: 'customer',
      mode: 'interface-visible',
      inputs: 'masked',
      text: 'masked',
      bodies: false,
    });
  });

  it('records a looser pick with what the recording captured, and describes it at consent and review', async () => {
    const { bundle, consents, reviews } = await record({ privacy: 'visible' });
    expect(bundle.meta.captured).toMatchObject({ inputs: 'visible', choice: { mode: 'visible', inputs: 'visible', text: 'visible' } });
    expect(consents[0]?.captures).toMatchObject({ pageText: true, inputs: true });
    expect(reviews[0]).toEqual(consents[0]);
  });
});
