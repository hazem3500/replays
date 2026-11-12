import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright-core';

import { capture, labelFor, parseArgs, selectorName } from '../src/capture/capture.ts';
import { agentBrowserDriver } from '../src/capture/drivers/agent-browser.ts';
import { AgentBrowser } from '../src/capture/drivers/agent-browser-cli.ts';
import { playwrightDriver } from '../src/capture/drivers/playwright.ts';
import type { CaptureDriver } from '../src/capture/drivers/types.ts';
import { RecorderSession } from '../src/capture/session.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';

const roots: string[] = [];
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'replays-pacing-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const argv = ['--url', 'https://example.com', '--output', '/tmp/replays-unused'];

describe('capture pacing options', () => {
  it('keeps pause optional and lets flags override host defaults', async () => {
    expect((await parseArgs(argv)).stepPauseMs).toBe(0);
    const config = join(await directory(), 'config.json');
    await writeFile(config, JSON.stringify({ capture: { stepPauseMs: 1200 } }));
    expect((await parseArgs([...argv, '--config', config])).stepPauseMs).toBe(1200);
    for (const value of ['0', '10000']) {
      expect((await parseArgs([...argv, '--config', config, '--step-pause', value])).stepPauseMs).toBe(Number(value));
    }
  });

  it.each(['-1', '10001', 'NaN', 'Infinity', 'slow'])('refuses invalid --step-pause %s', async (value) => {
    await expect(parseArgs([...argv, '--step-pause', value])).rejects.toThrow(/between 0 and 10000/);
  });

  it('validates config before opening a browser', async () => {
    const config = join(await directory(), 'config.json');
    for (const pacing of [{ stepPauseMs: -1 }, { stepPauseMs: '1200' }, { typo: 1200 }, null]) {
      await writeFile(config, JSON.stringify({ capture: pacing }));
      await expect(parseArgs([...argv, '--config', config])).rejects.toThrow(/capture|stepPauseMs/);
    }
  });
});

describe('capture labels', () => {
  it.each([
    ['text=Save', 'Save'],
    ['button[aria-label="Go to the Next Month"]', 'Go to the Next Month'],
    ['[data-tracking-id=holiday-calendar-add-date]', 'holiday calendar add date'],
    ["input[placeholder='Email address']", 'Email address'],
    ['input[placeholder^="Search developer"]', 'Search developer…'],
    ['input[placeholder$="developer"]', '…developer'],
    ['input[placeholder*="developer"]', '…developer…'],
    ['input[placeholder~="developer"]', '…developer…'],
    ['input[placeholder = "Email address" i]', 'Email address'],
    ['input[placeholder="Search"][aria-label="Find a developer"]', 'Find a developer'],
    ['input[name="developer_search"][placeholder="Search"]', 'developer search'],
    ['[name=first_name]', 'first name'],
    ['button:has-text("Save")', 'Save'],
    ['#plain-css', undefined],
  ])('names %s', (selector, name) => {
    expect(selectorName(selector)).toBe(name);
  });

  it('uses field names without including typed secrets, and respects explicit labels', () => {
    expect(labelFor({ kind: 'click', selector: 'text=Save' })).toBe('Click “Save”');
    expect(labelFor({ kind: 'click', selector: 'text=Profile:' })).toBe('Click “Profile”');
    for (const kind of ['type', 'fill'] as const) {
      expect(labelFor({ kind, selector: '[aria-label="Password"]', text: 'secret-value' })).toBe(
        kind === 'type' ? 'Type into “Password”' : 'Fill “Password”',
      );
    }
    expect(labelFor({ kind: 'click', selector: '#save', label: 'Save changes' })).toBe('Save changes');
    expect(labelFor({ kind: 'fill', selector: 'input[placeholder^="Search developer"]', text: 'private query' })).toBe(
      'Fill “Search developer”',
    );
    expect(
      labelFor({ kind: 'type', selector: 'input[placeholder^="Search developer"]', text: 'private query', label: 'Search developers' }),
    ).toBe('Search developers');
  });

  it('caps a long selector name at a word boundary and never ends a caption in an ellipsis', () => {
    const name = 'Review the quarterly budget forecast for the whole platform team before Friday';
    const label = labelFor({ kind: 'click', selector: `button[aria-label="${name}"]` });
    expect(label).toBe('Click “Review the quarterly budget forecast for the”');
    expect(labelFor({ kind: 'click', selector: 'button[aria-label^="Add a time entry"]' })).toBe('Click “Add a time entry”');
  });

  it('keeps technical selectors out of fallback captions', () => {
    expect(labelFor({ kind: 'click', selector: '#save > button.action:nth-child(2)' })).toBe('Click the button');
    expect(labelFor({ kind: 'click', selector: 'a.download' })).toBe('Click the link');
    expect(labelFor({ kind: 'hover', selector: '#menu > .target' })).toBe('Hover the control');
    for (const kind of ['fill', 'type'] as const) {
      expect(labelFor({ kind, selector: '#search-input', text: 'secret-value' })).toBe(
        kind === 'fill' ? 'Fill the field' : 'Type into the field',
      );
    }
  });
});

it.each([0, 1200])('holds non-wait actions for %sms and omits unlabelled waits from recorded steps', async (pause) => {
  const output = join(await directory(), 'out');
  const calls: unknown[] = [];
  const tracks = { origin: 1000, duration: 1000, events: [{ type: 2, timestamp: 1000 }], console: [], performance: undefined, steps: [] };
  vi.spyOn(RecorderSession, 'start').mockResolvedValue({
    flush: async () => {},
    stop: async () => tracks,
    dispose: () => {},
  } as unknown as RecorderSession);
  const driver: CaptureDriver = {
    name: 'fake',
    launch: async ({ harPath }) => {
      await writeFile(harPath, JSON.stringify({ log: { entries: [] } }));
      return { send: async () => ({}), on: () => {}, off: () => {} };
    },
    open: async () => {},
    step: async (step) => {
      calls.push(step.kind);
    },
    wait: async (ms) => {
      calls.push(ms);
    },
    finish: async () => {},
    close: async () => {},
  };
  const args = await parseArgs([...argv, '--output', output]);
  const result = await capture(
    {
      ...args,
      stepPauseMs: pause,
      steps: [
        { kind: 'click', selector: 'text=Save' },
        { kind: 'wait', ms: 300 },
        { kind: 'type', selector: '[name=email]', text: 'secret-value' },
        { kind: 'wait', ms: 900, label: 'Wait for export' },
      ],
    },
    driver,
  );
  const bundle = JSON.parse(await readFile(result.replayPath, 'utf8')) as ReplayBundle;
  expect(bundle.steps.map(({ label }) => label)).toEqual(['Open example.com', 'Click “Save”', 'Type into “email”', 'Wait for export']);
  expect(bundle.steps[2]?.selector).toBe('[name=email]');
  expect(JSON.stringify(bundle.steps)).not.toContain('secret-value');
  expect(calls).toEqual(pause ? [700, 'click', pause, 'wait', 'type', pause, 'wait', 900] : [700, 'click', 'wait', 'type', 'wait', 900]);
});

it('uses 80ms per character in the Playwright driver, leaving fill immediate', async () => {
  const pressSequentially = vi.fn<() => void>();
  const fill = vi.fn<() => void>();
  const close = vi.fn<() => Promise<void>>(async () => {});
  const match = { pressSequentially, fill };
  const page = { locator: () => ({ filter: () => ({ first: () => match }) }) };
  const context = { newPage: async () => page, newCDPSession: async () => ({}), close };
  vi.spyOn(chromium, 'launch').mockResolvedValue({ newContext: async () => context, close } as never);
  const driver = playwrightDriver();
  await driver.launch({ viewport: { width: 800, height: 600 }, harPath: '/unused' });
  await driver.step({ kind: 'type', selector: '#field', text: 'demo' });
  expect(pressSequentially).toHaveBeenCalledWith('demo', { delay: 80, timeout: 15000 });
  await driver.step({ kind: 'fill', selector: '#field', text: 'demo' });
  expect(fill).toHaveBeenCalledWith('demo', { timeout: 15000 });
  await driver.close();
});

function networkDriver(recordsBodies?: true): CaptureDriver {
  return {
    name: 'fake',
    ...(recordsBodies ? { recordsBodies } : {}),
    launch: async ({ harPath }) => {
      await writeFile(harPath, JSON.stringify({ log: { entries: [] } }));
      return { send: async () => ({}), on: () => {}, off: () => {} };
    },
    open: async () => {},
    step: async () => {},
    wait: async () => {},
    finish: async () => {},
    close: async () => {},
  };
}

function stubSession() {
  const tracks = { origin: 1000, duration: 1000, events: [{ type: 2, timestamp: 1000 }], console: [], performance: undefined, steps: [] };
  vi.spyOn(RecorderSession, 'start').mockResolvedValue({
    flush: async () => {},
    stop: async () => tracks,
    dispose: () => {},
  } as unknown as RecorderSession);
}

describe('--network bodies on a driver that cannot record them', () => {
  it('says what was requested and what was recorded', async () => {
    stubSession();
    const warnings: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      warnings.push(String(chunk));
      return true;
    });
    const args = await parseArgs([...argv, '--output', join(await directory(), 'out'), '--network', 'bodies']);
    const result = await capture(args, networkDriver());
    expect(result).toMatchObject({ networkRequested: 'bodies', networkMode: 'headers' });
    expect(warnings.join('')).toContain('--network bodies was requested but the fake driver cannot record bodies');
  });

  it('reports bodies when the driver records them, and off when asked for off', async () => {
    stubSession();
    const bodies = await capture(
      await parseArgs([...argv, '--output', join(await directory(), 'a'), '--network', 'bodies']),
      networkDriver(true),
    );
    expect(bodies).toMatchObject({ networkRequested: 'bodies', networkMode: 'bodies' });
    const off = await capture(await parseArgs([...argv, '--output', join(await directory(), 'b'), '--network', 'off']), networkDriver());
    expect(off).toMatchObject({ networkRequested: 'off', networkMode: 'off' });
  });
});

it('rejects an invalid programmatic pause before launching the driver', async () => {
  const args = await parseArgs(argv);
  const launch = vi.fn<() => void>();
  await expect(capture({ ...args, stepPauseMs: 10001 }, { launch } as unknown as CaptureDriver)).rejects.toThrow(/between 0 and 10000/);
  expect(launch).not.toHaveBeenCalled();
});

it('requests 80ms typing from agent-browser without adding a delay to fill', async () => {
  const command = vi.spyOn(AgentBrowser.prototype, 'command').mockResolvedValue({});
  const driver = agentBrowserDriver();
  await driver.step({ kind: 'type', selector: '#field', text: 'demo' });
  expect(command).toHaveBeenCalledWith(['type', '#field', 'demo', '--delay', '80']);
  await driver.step({ kind: 'fill', selector: '#field', text: 'demo' });
  expect(command).toHaveBeenLastCalledWith(['fill', '#field', 'demo']);
});

async function driverAt(openUrl: string) {
  const goto = vi.fn<(url: string) => Promise<void>>(async () => {});
  const close = vi.fn<() => Promise<void>>(async () => {});
  const page = { goto, url: () => openUrl };
  const context = { newPage: async () => page, newCDPSession: async () => ({}), close };
  vi.spyOn(chromium, 'launch').mockResolvedValue({ newContext: async () => context, close } as never);
  const driver = playwrightDriver();
  await driver.launch({ viewport: { width: 800, height: 600 }, harPath: '/unused' });
  return { driver, goto };
}


describe('a goto step', () => {
  it('does not reload the page that is already open', async () => {
    const { driver, goto } = await driverAt('https://example.com/shop?a=1');
    await driver.step({ kind: 'goto', url: 'https://example.com/shop?a=1' });
    await driver.step({ kind: 'goto', url: '/shop?a=1' });
    expect(goto).not.toHaveBeenCalled();
    await driver.close();
  });

  it('navigates to a different page', async () => {
    const { driver, goto } = await driverAt('https://example.com/shop');
    await driver.step({ kind: 'goto', url: 'https://example.com/cart' });
    expect(goto).toHaveBeenCalledWith('https://example.com/cart', { waitUntil: 'load', timeout: 30_000 });
    await driver.close();
  });
});
