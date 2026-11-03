// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recorderChoices as choicesWith } from './recorder-choices.ts';
import { settingsBuilder } from './recorder-settings.ts';
import { createRecorder } from './recorder.ts';
import { must } from './testing.ts';
import { createFakeRrweb, createFakeTransport } from './testing/fakes.ts';
import type { ReplayRrwebEvent } from './bundle-types.ts';
import type { PrivacyFacts, RecorderOptions, RecorderPrivacyMode, RecorderUi, RecordingChoice, RrwebModule } from './types.ts';

type Host = Pick<RecorderOptions, 'choices' | 'privacy' | 'capture'>;
const recorderChoices = (host: Host) => choicesWith(host, settingsBuilder(host));
const MODES: RecorderPrivacyMode[] = ['visible', 'text-masked', 'masked'];
const MEDIA = 'img, picture, video, audio, canvas, iframe, object, embed';
/** An internal host that allows everything a mode can ask for. */
const OPEN_HOST: Host = {
  privacy: { sanitize: false, blockMedia: false },
  choices: { privacy: MODES, profiles: ['triage', 'design-review'] },
};
const facts = (host: Host, mode: RecorderPrivacyMode) => recorderChoices(host).settings({ privacy: mode }).privacy.facts(180_000, true);
const rrwebOf = (host: Host, mode: RecorderPrivacyMode) => recorderChoices(host).settings({ privacy: mode }).privacy.rrwebOptions();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const resetStorage = () => {
  vi.unstubAllGlobals();
  localStorage.clear();
};
const blocked = () => {
  throw new DOMException('The operation is insecure.', 'SecurityError');
};
const SHOWN = ['pageText', 'inputs', 'media'] as const;
/** Every `mode.capture` a mode records that the host's own privacy does not. */
const exceeded = (host: Host, cap: PrivacyFacts['captures']) =>
  MODES.flatMap((mode) => SHOWN.filter((key) => facts(host, mode).captures[key] && !cap[key]).map((key) => `${mode}.${key}`));

describe('recording choices', () => {
  afterEach(resetStorage);

  it.each([
    ['visible', { maskAllInputs: false, maskTextSelector: undefined, media: false }],
    ['text-masked', { maskAllInputs: true, maskTextSelector: '*', media: false }],
    ['masked', { maskAllInputs: true, maskTextSelector: '*', media: true }],
  ] as const)('maps %s to its capture settings', (mode, expected) => {
    const settings = recorderChoices(OPEN_HOST).settings({ privacy: mode });
    const options = settings.privacy.rrwebOptions();
    expect(options.maskAllInputs).toBe(expected.maskAllInputs);
    expect(options.maskTextSelector).toBe(expected.maskTextSelector);
    expect(String(options.blockSelector).includes(MEDIA)).toBe(expected.media);
    expect(settings.capture).toMatchObject({ maskAllText: expected.maskTextSelector === '*', blockMedia: expected.media });
  });

  it('keeps passwords and hidden inputs masked in visible mode', () => {
    expect(rrwebOf(OPEN_HOST, 'visible').maskInputOptions).toEqual({ password: true, hidden: true });
  });

  const hosts: [string, Host][] = [
    ['text only', { privacy: { maskAllText: false } }],
    ['inputs and text, media blocked', { privacy: { sanitize: false } }],
    ['media only', { privacy: { blockMedia: false } }],
    ['a capture block that masks text', { privacy: { sanitize: false, blockMedia: false }, capture: { privacy: { maskAllText: true } } }],
  ];
  it.each(hosts)('never shows more than a host that allows %s', (_, own) => {
    const host: Host = { ...own, choices: { privacy: MODES } };
    const cap = recorderChoices(own).settings().privacy.facts(180_000, true).captures;
    expect(exceeded(host, cap)).toEqual([]);
  });

  it('offers nothing to a host with the default privacy, whatever choices lists', () => {
    const customer: Host = { choices: { privacy: MODES, profiles: ['triage', 'walkthrough'] } };
    expect(recorderChoices(customer).offer((privacy) => privacy.facts(1, true))).toBeUndefined();
    expect(facts(customer, 'visible').captures).toMatchObject({ pageText: false, inputs: false, media: false });
  });

  it('offers modes the host cap makes identical once, under the stricter name', () => {
    const host: Host = { privacy: { sanitize: false }, choices: { privacy: MODES } };
    const offer = must(recorderChoices(host).offer((privacy) => privacy.facts(1, true)));
    expect(offer.privacy.map((entry) => entry.mode)).toEqual(['visible', 'masked']);
    expect(offer.privacy[0]?.facts.captures).toMatchObject({ pageText: true, inputs: true, media: false });
  });
});

describe('recording choice offers', () => {
  afterEach(resetStorage);

  it('starts with the most masked mode offered and the first profile', () => {
    const offer = must(recorderChoices(OPEN_HOST).offer((privacy) => privacy.facts(1, true)));
    expect(offer.initial).toEqual({ privacy: 'masked', profile: 'triage' });
    expect(offer.defaults).toEqual(offer.initial);
  });

  it('reduces a choice outside the offer to the defaults', () => {
    const host: Host = { ...OPEN_HOST, choices: { privacy: ['text-masked', 'masked'], profiles: ['triage', 'walkthrough'] } };
    expect(recorderChoices(host).accept({ privacy: 'visible', profile: 'other' })).toEqual({ privacy: 'masked', profile: 'triage' });
  });

  it('remembers the last choice for the next offer on this origin', () => {
    recorderChoices(OPEN_HOST).accept({ privacy: 'visible', profile: 'design-review' });
    const offer = must(recorderChoices(OPEN_HOST).offer((privacy) => privacy.facts(1, true)));
    expect(offer.initial).toEqual({ privacy: 'visible', profile: 'design-review' });
  });

  it('falls back to the defaults when storage is blocked', () => {
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked });
    const choices = recorderChoices(OPEN_HOST);
    expect(choices.accept({ privacy: 'visible' })).toEqual({ privacy: 'visible', profile: 'triage' });
    expect(must(choices.offer((privacy) => privacy.facts(1, true))).initial).toEqual({ privacy: 'masked', profile: 'triage' });
  });

  it('offers each profile with its label and description, and words a bare id', () => {
    const host: Host = {
      ...OPEN_HOST,
      choices: {
        profiles: [{ id: 'performance', label: 'Performance', description: 'Slow pages, with vitals and requests' }, 'design-review'],
      },
    };
    expect(must(recorderChoices(host).offer((privacy) => privacy.facts(1, true))).profiles).toEqual([
      { id: 'performance', label: 'Performance', description: 'Slow pages, with vitals and requests' },
      { id: 'design-review', label: 'Design review' },
    ]);
  });

  it('rejects a profile that is not a profile id', () => {
    expect(() => recorderChoices({ ...OPEN_HOST, choices: { profiles: ['Design Review'] } })).toThrow('not a profile id');
  });
});

function optionsUi(choice?: RecordingChoice) {
  const consents: (PrivacyFacts | undefined)[] = [];
  let stop: (() => void) | undefined;
  const chooseOptions = vi.fn<NonNullable<RecorderUi['chooseOptions']>>(() => Promise.resolve(choice));
  const ui: RecorderUi = {
    chooseOptions,
    requestConsent: ({ privacy }) => {
      consents.push(privacy);
      return Promise.resolve(true);
    },
    showIndicator: (context) => {
      stop = context.stop;
      return () => {};
    },
    confirmUpload: () => Promise.resolve({ confirmed: true }),
  };
  return { ui, chooseOptions, consents, stop: () => stop?.() };
}

/** The fake rrweb, keeping the masking options of every recording. */
function watchedRrweb() {
  const rrweb = createFakeRrweb();
  const options: Record<string, unknown>[] = [];
  const module: RrwebModule = {
    record: (recordOptions) => {
      options.push(recordOptions);
      return rrweb.module.record(recordOptions);
    },
  };
  return { load: () => Promise.resolve(module), emit: (event: ReplayRrwebEvent) => rrweb.emit(event), options };
}

/** One recording through `request()` with the options step answered by `ui`. */
async function record(options: Partial<RecorderOptions>, ui: ReturnType<typeof optionsUi>) {
  const rrweb = watchedRrweb();
  const transport = createFakeTransport();
  const recorder = createRecorder({ upload: transport.upload, loadRrweb: rrweb.load, activation: () => true, ui: ui.ui, ...options });
  const done = recorder.request();
  await vi.waitFor(() => expect(recorder.getState().status).toBe('recording'));
  rrweb.emit({ type: 3, timestamp: Date.now() + 1_000, data: {} });
  ui.stop();
  await done;
  return { recorder, rrweb, bundle: transport.reports[0]?.bundle };
}

describe('recorder options step', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
  });

  it('asks before consent and describes the chosen mode in the consent prompt', async () => {
    const ui = optionsUi({ privacy: 'visible', profile: 'design-review' });
    const { bundle } = await record(OPEN_HOST, ui);
    expect(ui.consents[0]?.captures).toMatchObject({ pageText: true, inputs: true, media: true });
    expect(bundle?.meta.profile).toBe('design-review');
  });

  it('records nothing and asks for no consent when the options step is closed', async () => {
    const ui = optionsUi();
    const recorder = createRecorder({ upload: createFakeTransport().upload, ui: ui.ui, ...OPEN_HOST });
    await recorder.request();
    expect(ui.consents).toEqual([]);
    expect(recorder.getState().status).toBe('idle');
  });

  it('never shows the step to a host with the default privacy', async () => {
    const ui = optionsUi({ privacy: 'visible' });
    const { bundle } = await record({ choices: { privacy: MODES, profiles: ['triage', 'walkthrough'] } }, ui);
    expect(ui.chooseOptions).not.toHaveBeenCalled();
    expect(ui.consents[0]?.captures).toMatchObject({ pageText: false, inputs: false, media: false });
    expect(bundle?.meta).not.toHaveProperty('profile');
  });

  it('applies the choice to that recording only', async () => {
    const first = optionsUi({ privacy: 'visible' });
    const { recorder, rrweb } = await record({ ...OPEN_HOST, choices: { ...OPEN_HOST.choices, remember: false } }, first);
    await recorder.start({ consent: true });
    recorder.discard();
    expect(rrweb.options.map((options) => options.maskTextSelector)).toEqual([undefined, '*']);
  });

  it('drops credentials from URLs and auth headers in visible mode', async () => {
    globalThis.fetch = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}')));
    const rrweb = createFakeRrweb();
    const transport = createFakeTransport();
    const recorder = createRecorder({ upload: transport.upload, loadRrweb: rrweb.load, activation: () => true, ...OPEN_HOST });
    await recorder.start({ consent: true, choice: { privacy: 'visible' } });
    await fetch('/api/cart?access_token=tok_live_123', { headers: { authorization: 'Bearer tok_live_123', accept: 'application/json' } });
    await flush();
    rrweb.emit({ type: 3, timestamp: Date.now() + 1_000, data: {} });
    recorder.stop();
    await recorder.upload({ confirmed: true });
    const entry = must(must(transport.reports[0]).bundle.network[0]);
    expect(entry.url).not.toContain('tok_live_123');
    expect(entry.requestHeaders.map((header) => header.name)).toEqual(['accept']);
  });
  it('fails the start, not the page, when choices lists an invalid profile', async () => {
    const recorder = createRecorder({
      upload: createFakeTransport().upload,
      loadRrweb: createFakeRrweb().load,
      ...OPEN_HOST,
      choices: { profiles: ['Design Review'] },
    });
    await expect(recorder.start({ consent: true })).rejects.toThrow('not a profile id');
    expect(recorder.getState()).toMatchObject({ status: 'error', phase: 'start' });
  });
});
