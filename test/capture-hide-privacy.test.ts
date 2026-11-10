import { readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { capture, parseArgs } from '../src/capture/capture.ts';
import { assertPrivacyFitsProfile, CAPTURE_PRIVACY_MODES, inputsVisible, privacyFlag } from '../src/capture/capture-privacy.ts';
import { capturedRecord } from '../src/capture/capture-settings.ts';
import { playwrightDriver } from '../src/capture/drivers/playwright.ts';
import type { CaptureDriver, LaunchOptions, RawStep } from '../src/capture/drivers/types.ts';
import { assertHideSelectors, hideScript } from '../src/capture/hide-selectors.ts';
import { compressPacingWaits, isPacingWait, pacingClock, pacingWaitLabel } from '../src/capture/pacing-waits.ts';
import { recorderScript, RecorderSession, type CdpLike } from '../src/capture/session.ts';
import { isRecord } from '../src/shared/validate.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';

const argv = ['--url', 'https://example.com', '--output', '/tmp/replays-unused'];
const roots: string[] = [];
const directory = async () => {
  const root = await mkdtemp(join(tmpdir(), 'replays-hide-'));
  roots.push(root);
  return root;
};
const cleanUp = () =>
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

describe('--privacy', () => {
  cleanUp();

  it('accepts the recorder modes and refuses anything else', () => {
    expect(CAPTURE_PRIVACY_MODES).toEqual(['visible', 'inputs-masked', 'text-masked', 'interface-visible', 'masked']);
    for (const mode of CAPTURE_PRIVACY_MODES) expect(privacyFlag(mode)).toBe(mode);
    expect(privacyFlag()).toBeUndefined();
    expect(() => privacyFlag('full')).toThrow('--privacy must be one of visible, inputs-masked, text-masked, interface-visible, masked');
  });

  it('never loosens a profile that masks all text', () => {
    for (const mode of ['visible', 'inputs-masked', 'interface-visible'] as const)
      expect(() => assertPrivacyFitsProfile(mode, true)).toThrow(/shows page text, but this profile masks all text/);
    for (const mode of ['text-masked', 'masked'] as const) expect(() => assertPrivacyFitsProfile(mode, true)).not.toThrow();
    expect(() => assertPrivacyFitsProfile('visible', false)).not.toThrow();
    expect(() => assertPrivacyFitsProfile(undefined, true)).not.toThrow();
  });

  it('declares typed values in the bundle only for the visible mode', () => {
    const settings = { network: 'headers' as const, performance: true };
    expect(inputsVisible('visible')).toBe(true);
    for (const mode of [undefined, ...CAPTURE_PRIVACY_MODES.filter((option) => option !== 'visible')])
      expect(inputsVisible(mode)).toBe(false);
    expect(capturedRecord({ ...settings, inputsVisible: true }, false, false)).toHaveProperty('inputs', 'visible');
    expect(capturedRecord({ ...settings, inputsVisible: false }, false, false)).not.toHaveProperty('inputs');
    expect(capturedRecord(settings, false, false)).not.toHaveProperty('inputs');
  });

  it('reads the flag and refuses a profile it would loosen', async () => {
    expect((await parseArgs(argv)).privacy).toBeUndefined();
    expect((await parseArgs([...argv, '--privacy', 'interface-visible'])).privacy).toBe('interface-visible');
    await expect(parseArgs([...argv, '--privacy', 'everything'])).rejects.toThrow(/--privacy must be one of/);
    const root = await directory();
    const config = join(root, 'replays.config.json');
    await writeFile(
      config,
      JSON.stringify({ profiles: [{ id: 'private', label: 'Private', capture: { privacy: { maskAllText: true } } }] }),
    );
    const withProfile = [...argv, '--config', config, '--profile', 'private'];
    await expect(parseArgs([...withProfile, '--privacy', 'visible'])).rejects.toThrow(/profile masks all text/);
    expect((await parseArgs([...withProfile, '--privacy', 'masked'])).privacy).toBe('masked');
  });

  it('hands the mode to the page only when one is asked for', () => {
    expect(recorderScript('x();', undefined, { privacy: 'visible' })).toContain('window.__REPLAYS_PRIVACY__="visible";');
    expect(recorderScript('x();')).not.toContain('__REPLAYS_PRIVACY__');
    expect(recorderScript('x();', {}, {})).toBe('x();');
  });
});

describe('--hide', () => {
  cleanUp();

  it('builds one style rule per selector and puts it back when the head is replaced', () => {
    const script = hideScript(['#banner', '[data-chat]']);
    expect(script).toContain('#banner{display:none!important');
    expect(script).toContain('[data-chat]{display:none!important');
    expect(script).toContain('MutationObserver');
  });

  it('checks every selector in the browser and names the one it rejects', async () => {
    const asked: string[] = [];
    const cdp: CdpLike = {
      send: (_method, params) => {
        const expression = String(params?.expression);
        asked.push(expression);
        return Promise.resolve({ result: { value: !expression.includes('div[') } });
      },
      on: () => {},
      off: () => {},
    };
    await expect(assertHideSelectors(cdp, ['#a', '.b'])).resolves.toBeUndefined();
    await expect(assertHideSelectors(cdp, ['#a', 'div['])).rejects.toThrow('--hide "div[" is not a valid CSS selector');
    expect(asked).toHaveLength(4);
  });

  it('collects every repeated flag', async () => {
    expect((await parseArgs(argv)).hide).toBeUndefined();
    expect((await parseArgs([...argv, '--hide', '#CybotCookiebotDialog', '--hide', '.chat, .promo'])).hide).toEqual([
      '#CybotCookiebotDialog',
      '.chat, .promo',
    ]);
  });
});

describe('pacing flags', () => {
  cleanUp();

  it('reads --type-delay, --shot-delay and --step-delay within their ranges', async () => {
    const plain = await parseArgs(argv);
    expect(plain.typeDelayMs).toBeUndefined();
    expect(plain.shotDelayMs).toBeUndefined();
    const set = await parseArgs([...argv, '--type-delay', '0', '--shot-delay', '2000', '--step-delay', '1200', '--compress-waits']);
    expect(set).toMatchObject({ typeDelayMs: 0, shotDelayMs: 2000, stepPauseMs: 1200, compressWaits: true });
    expect((await parseArgs([...argv, '--step-pause', '300'])).stepPauseMs).toBe(300);
  });

  it.each([
    [['--type-delay', '1001'], /--type-delay must be a number of milliseconds between 0 and 1000/],
    [['--type-delay', 'fast'], /--type-delay must be/],
    [['--shot-delay', '10001'], /--shot-delay must be a number of milliseconds between 0 and 10000/],
    [['--shot-delay', '-1'], /--shot-delay must be/],
    [['--step-delay', '1', '--step-pause', '1'], /--step-delay is the same flag as --step-pause/],
    [['--compress-waits', '--video'], /--compress-waits cannot be combined with --video/],
  ])('refuses %j', async (flags, message) => {
    await expect(parseArgs([...argv, ...flags])).rejects.toThrow(message);
  });

  it('compresses a long unlabelled wait on every track and keeps a short or labelled one', () => {
    expect(isPacingWait({ kind: 'wait', ms: 5001 })).toBe(true);
    expect(isPacingWait({ kind: 'wait', ms: 5000 })).toBe(false);
    expect(isPacingWait({ kind: 'wait', ms: 60_000, label: 'Wait for the export' })).toBe(false);
    expect(isPacingWait({ kind: 'wait', ms: 60_000, label: '  ' })).toBe(true);
    expect(isPacingWait({ kind: 'click' })).toBe(false);
    expect(pacingWaitLabel({ from: 0, to: 20_400 })).toBe('Waited 20 s, sped up here');

    const clock = pacingClock([{ from: 1000, to: 21_000 }]);
    expect([clock(500), clock(1000), clock(11_000), clock(21_000), clock(30_000)]).toEqual([500, 1000, 2000, 3000, 12_000]);

    const bundle: ReplayBundle = {
      meta: {
        id: 'long-wait',
        title: 'Long wait',
        url: 'https://example.test/',
        capturedAt: '2026-01-01T00:00:00.000Z',
        duration: 30_000,
        viewport: { width: 1280, height: 800 },
        eventCount: 3,
        version: 1,
      },
      events: [{ timestamp: 100 }, { timestamp: 5100 }, { timestamp: 30_100 }],
      console: [{ at: 25_000, level: 'log', message: 'late' }],
      network: [
        {
          id: 'r1',
          at: 2000,
          duration: 5,
          method: 'GET',
          url: 'https://example.test/api',
          status: 200,
          statusText: 'OK',
          requestHeaders: [],
          responseHeaders: [],
        },
      ],
      steps: [{ at: 21_000, kind: 'click', label: 'Click' }],
      performance: { supported: [], entries: [{ at: 30_000, kind: 'long-task', value: 60 }] },
    };
    const result = compressPacingWaits(bundle, [{ from: 1000, to: 21_000 }]);
    expect(result.meta.duration).toBe(12_000);
    expect(result.events.map((event) => event.timestamp)).toEqual([100, 1500, 12_100]);
    expect(result.console[0]?.at).toBe(7000);
    expect(result.network[0]?.at).toBe(1100);
    expect(result.steps[0]?.at).toBe(3000);
    expect(result.performance?.entries[0]?.at).toBe(12_000);
    expect(compressPacingWaits(bundle, [])).toBe(bundle);
  });
});

const emptyLog = () => ({ steps: [] as RawStep[], launches: [] as LaunchOptions[], waits: [] as number[] });

async function readBundle(path: string): Promise<unknown> {
  const bundle: unknown = JSON.parse(await readFile(path, 'utf8'));
  return bundle;
}

function metaOf(bundle: unknown): Record<string, unknown> {
  return isRecord(bundle) && isRecord(bundle.meta) ? bundle.meta : {};
}

function stepLabels(bundle: unknown): unknown[] {
  const steps: unknown = isRecord(bundle) ? bundle.steps : undefined;
  return Array.isArray(steps) ? steps.map((step: unknown) => (isRecord(step) ? step.label : undefined)) : [];
}

function isSession(value: unknown): value is RecorderSession {
  return typeof value === 'object' && value !== null && 'stop' in value && 'flush' in value && 'dispose' in value;
}

function fakeDriver(
  log: { steps: RawStep[]; launches: LaunchOptions[]; waits: number[] },
  onStep?: (step: RawStep) => void,
): CaptureDriver {
  return {
    name: 'fake',
    launch: async (options) => {
      log.launches.push(options);
      await writeFile(options.harPath, JSON.stringify({ log: { entries: [] } }));
      return { send: () => Promise.resolve({}), on: () => {}, off: () => {} };
    },
    open: async () => {},
    step: (step) => {
      log.steps.push(step);
      onStep?.(step);
      return Promise.resolve();
    },
    wait: (ms) => {
      log.waits.push(ms);
      return Promise.resolve();
    },
    screenshot: (path) => writeFile(path, 'png'),
    finish: async () => {},
    close: async () => {},
  };
}

function stubSession(origin: number, duration: number) {
  const tracks = { origin, duration, events: [{ type: 2, timestamp: origin }], console: [], performance: undefined, steps: [] };
  const session: unknown = { flush: () => Promise.resolve(), stop: () => Promise.resolve(tracks), dispose: () => {} };
  if (!isSession(session)) throw new Error('the session stub is incomplete');
  return vi.spyOn(RecorderSession, 'start').mockResolvedValue(session);
}

describe('capture with the new options', () => {
  cleanUp();

  it('starts the recorder with the privacy mode and hidden selectors, and tells the driver the type delay', async () => {
    const started = stubSession(1000, 1000);
    const log = emptyLog();
    const output = join(await directory(), 'out');
    const result = await capture(
      {
        ...(await parseArgs([...argv, '--output', output, '--privacy', 'visible', '--hide', '#banner', '--type-delay', '5'])),
        steps: [{ kind: 'type', selector: '#name', text: 'Ada' }],
      },
      fakeDriver(log),
    );
    expect(started.mock.calls[0]?.[1]).toMatchObject({ privacy: 'visible', hide: ['#banner'] });
    expect(log.launches[0]?.typeDelayMs).toBe(5);
    const bundle = await readBundle(result.replayPath);
    expect(metaOf(bundle).captured).toMatchObject({ inputs: 'visible' });
  });

  it('keeps the defaults when no option is given', async () => {
    const started = stubSession(1000, 1000);
    const log = emptyLog();
    const output = join(await directory(), 'out');
    const result = await capture(
      { ...(await parseArgs([...argv, '--output', output])), steps: [{ kind: 'click', selector: '#a' }] },
      fakeDriver(log),
    );
    expect(started.mock.calls[0]?.[1]).not.toHaveProperty('privacy');
    expect(started.mock.calls[0]?.[1]).not.toHaveProperty('hide');
    expect(log.launches[0]?.typeDelayMs).toBe(80);
    expect(log.waits.filter((ms) => ms !== 700 && ms !== 900)).toEqual([]);
    const bundle = await readBundle(result.replayPath);
    expect(metaOf(bundle).captured).not.toHaveProperty('inputs');
  });

  it('holds after a shot for --shot-delay, else for the step pause', async () => {
    stubSession(1000, 1000);
    const steps = [
      { kind: 'click', selector: '#a' },
      { kind: 'shot', name: 'one' },
      { kind: 'wait', ms: 10 },
    ] satisfies RawStep[];
    const held = async (flags: string[]) => {
      const log = emptyLog();
      await capture({ ...(await parseArgs([...argv, '--output', join(await directory(), 'out'), ...flags])), steps }, fakeDriver(log));
      return log.waits.filter((ms) => ms !== 700 && ms !== 900);
    };
    expect(await held([])).toEqual([]);
    expect(await held(['--step-pause', '300'])).toEqual([300, 300]);
    expect(await held(['--step-pause', '300', '--shot-delay', '2000'])).toEqual([300, 2000]);
    expect(await held(['--shot-delay', '2000'])).toEqual([2000]);
    expect(await held(['--step-pause', '300', '--shot-delay', '0'])).toEqual([300]);
  });
});

describe('capture with --compress-waits', () => {
  cleanUp();

  it('compresses an unlabelled long wait, captions it and moves later shots onto the replay clock', async () => {
    const start = 1_800_000_000_000;
    let now = start;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    stubSession(start, 30_000);
    const log = emptyLog();
    const driver = fakeDriver(log, (step) => {
      if (step.kind === 'wait' && 'ms' in step) now += step.ms;
    });
    const result = await capture(
      {
        ...(await parseArgs([...argv, '--output', join(await directory(), 'out'), '--compress-waits'])),
        steps: [
          { kind: 'wait', ms: 20_000 },
          { kind: 'wait', ms: 3000 },
          { kind: 'shot', name: 'later' },
        ],
      },
      driver,
    );
    const bundle = await readBundle(result.replayPath);
    expect(metaOf(bundle).duration).toBe(12_000);
    expect(stepLabels(bundle)).toContain('Waited 20 s, sped up here');
    expect(result.shots?.[0]?.at).toBe(5000);
  });

  it('leaves waits whole without the flag', async () => {
    const start = 1_800_000_000_000;
    let now = start;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    stubSession(start, 30_000);
    const log = emptyLog();
    const driver = fakeDriver(log, (step) => {
      if (step.kind === 'wait' && 'ms' in step) now += step.ms;
    });
    const result = await capture(
      { ...(await parseArgs([...argv, '--output', join(await directory(), 'out')])), steps: [{ kind: 'wait', ms: 20_000 }] },
      driver,
    );
    const bundle = await readBundle(result.replayPath);
    expect(metaOf(bundle).duration).toBe(30_000);
    expect(stepLabels(bundle)).not.toContain('Waited 20 s, sped up here');
  });
});

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const found = readdirSync('/usr/bin').find((name) => /^(\w+-)?chrom(e|ium)(-stable|-browser)?$/.test(name));
  return found ? `/usr/bin/${found}` : undefined;
}
const CHROME = findChrome();

const PAGE = `<!doctype html><body>
<div id="banner">Cookie banner text</div>
<h1>Quarterly headline</h1>
<p data-replay-public>Public product text</p>
<input id="name"><input id="pw" type="password"><img id="logo" width="40" height="40" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
</body>`;

describe.skipIf(!CHROME)('the recorder in a real page', () => {
  cleanUp();

  let server: Server | undefined;
  let url = '';
  const saved = { chrome: process.env.CHROME_PATH, sandbox: process.env.CHROMIUM_NO_SANDBOX };
  beforeAll(async () => {
    process.env.CHROME_PATH = CHROME;
    process.env.CHROMIUM_NO_SANDBOX ??= '1';
    server = createServer((_request, response) => response.writeHead(200, { 'content-type': 'text/html' }).end(PAGE));
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`;
  });
  afterAll(() => {
    server?.close();
    process.env.CHROME_PATH = saved.chrome;
    process.env.CHROMIUM_NO_SANDBOX = saved.sandbox;
  });

  async function record(options: Parameters<typeof RecorderSession.start>[1]) {
    const driver = playwrightDriver();
    const cdp = await driver.launch({ viewport: { width: 800, height: 600 }, harPath: join(await directory(), 'a.har') });
    try {
      const session = await RecorderSession.start(cdp, options);
      await driver.open(url);
      await driver.step({ kind: 'fill', selector: '#name', text: 'typed-secret' });
      await driver.step({ kind: 'fill', selector: '#pw', text: 'password-secret' });
      await driver.wait(300);
      const display = await cdp.send('Runtime.evaluate', {
        expression: `getComputedStyle(document.querySelector('#banner')).display`,
        returnByValue: true,
      });
      const tracks = await session.stop();
      await driver.finish();
      return { events: JSON.stringify(tracks.events), display: JSON.stringify(display) };
    } finally {
      await driver.close();
    }
  }

  it('masks typed values by default and shows them in the visible mode, passwords never', async () => {
    const plain = await record({});
    expect(plain.events).toContain('Quarterly headline');
    expect(plain.events).not.toContain('typed-secret');
    const visible = await record({ privacy: 'visible' });
    expect(visible.events).toContain('typed-secret');
    expect(visible.events).toContain('Quarterly headline');
    expect(visible.events).not.toContain('password-secret');
    const same = await record({ privacy: 'inputs-masked' });
    expect(same.events).not.toContain('typed-secret');
    expect(same.events).toContain('Quarterly headline');
  }, 60_000);

  it('masks page text in text-masked and masked, keeping only public text in interface-visible', async () => {
    const textMasked = await record({ privacy: 'text-masked' });
    expect(textMasked.events).not.toContain('Quarterly headline');
    expect(textMasked.events).not.toContain('typed-secret');
    const masked = await record({ privacy: 'masked' });
    expect(masked.events).not.toContain('Quarterly headline');
    expect(masked.events).not.toContain('Public product text');
    const interfaceOnly = await record({ privacy: 'interface-visible' });
    expect(interfaceOnly.events).not.toContain('Quarterly headline');
    expect(interfaceOnly.events).toContain('Public product text');
  }, 90_000);

  it('hides matching elements from the first frame', async () => {
    expect((await record({})).display).toContain('block');
    expect((await record({ hide: ['#banner'] })).display).toContain('none');
  }, 60_000);
});
