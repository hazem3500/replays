import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { capture, labelFor, parseArgs } from '../src/capture/capture.ts';
import { agentBrowserDriver } from '../src/capture/drivers/agent-browser.ts';
import { AgentBrowser } from '../src/capture/drivers/agent-browser-cli.ts';
import { readStateFile } from '../src/capture/drivers/storage-state.ts';
import type { CaptureDriver, LaunchOptions, RawStep } from '../src/capture/drivers/types.ts';
import { waitForSelectorOverCdp } from '../src/capture/drivers/wait-selector.ts';
import { RecorderSession } from '../src/capture/session.ts';

const roots: string[] = [];
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'replays-shots-'));
  roots.push(root);
  return root;
}
/** Restores mocks and removes the temporary directories after each test of the describe that calls it. */
function useCleanup() {
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });
}

const argv = ['--url', 'https://example.com', '--output', '/tmp/replays-unused'];

function isSession(value: unknown): value is RecorderSession {
  return typeof value === 'object' && value !== null && 'stop' in value && 'flush' in value && 'dispose' in value;
}

function stubSession() {
  const tracks = { origin: 1000, duration: 1000, events: [{ type: 2, timestamp: 1000 }], console: [], performance: undefined, steps: [] };
  const session: unknown = { flush: () => Promise.resolve(), stop: () => Promise.resolve(tracks), dispose: () => {} };
  if (!isSession(session)) throw new Error('the session stub is incomplete');
  vi.spyOn(RecorderSession, 'start').mockResolvedValue(session);
}

function recordingDriver(log: { steps: RawStep[]; launches: LaunchOptions[] }, screenshot?: CaptureDriver['screenshot']): CaptureDriver {
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
      return Promise.resolve();
    },
    wait: async () => {},
    ...(screenshot ? { screenshot } : {}),
    finish: async () => {},
    close: async () => {},
  };
}

describe('shot steps', () => {
  useCleanup();

  it('saves a PNG per shot and lists each with its file, label, step number and time', async () => {
    stubSession();
    const output = join(await directory(), 'out');
    const log = { steps: [] as RawStep[], launches: [] as LaunchOptions[] };
    const saved: string[] = [];
    const driver = recordingDriver(log, async (path) => {
      saved.push(path);
      await writeFile(path, 'png');
    });
    const result = await capture(
      {
        ...(await parseArgs([...argv, '--output', output])),
        steps: [
          { kind: 'click', selector: 'text=Save' },
          { kind: 'shot', name: 'after-save', label: 'Saved banner shows' },
          { kind: 'wait', ms: 10 },
          { kind: 'shot', name: 'second' },
        ],
      },
      driver,
    );
    const bundle: unknown = JSON.parse(await readFile(result.replayPath, 'utf8'));

    expect(saved).toEqual([join(output, 'shots', 'after-save.png'), join(output, 'shots', 'second.png')]);
    const shots = result.shots ?? [];
    expect((await stat(join(output, 'shots', 'after-save.png'))).isFile()).toBe(true);
    expect(shots.map(({ at, ...rest }) => ({ ...rest, timed: Number.isFinite(at) }))).toEqual([
      { name: 'after-save', file: join(output, 'shots', 'after-save.png'), label: 'Saved banner shows', step: 3, timed: true },
      { name: 'second', file: join(output, 'shots', 'second.png'), label: 'Screenshot “second”', step: 4, timed: true },
    ]);
    for (const shot of shots) {
      const at = ['steps', shot.step - 1];
      expect(bundle).toHaveProperty([...at, 'kind'], 'shot');
      expect(bundle).toHaveProperty([...at, 'label'], shot.label);
      expect(bundle).toHaveProperty([...at, 'at'], shot.at);
    }
    expect(log.steps.map((step) => step.kind)).toEqual(['click', 'wait']);
  });

  it('leaves shots out of the result when no step took one', async () => {
    stubSession();
    const log = { steps: [] as RawStep[], launches: [] as LaunchOptions[] };
    const result = await capture(
      { ...(await parseArgs([...argv, '--output', join(await directory(), 'out')])), steps: [{ kind: 'click', selector: '#a' }] },
      recordingDriver(log),
    );
    expect(result).not.toHaveProperty('shots');
  });

  it('fails clearly when the driver cannot take screenshots', async () => {
    stubSession();
    const log = { steps: [] as RawStep[], launches: [] as LaunchOptions[] };
    await expect(
      capture(
        { ...(await parseArgs([...argv, '--output', join(await directory(), 'out')])), steps: [{ kind: 'shot', name: 'a' }] },
        recordingDriver(log),
      ),
    ).rejects.toThrow('a shot step needs a driver that can take screenshots; fake cannot');
  });
});

describe('step captions', () => {
  useCleanup();

  it('names selector waits, scrolls to a selector and shots without exposing selector syntax', () => {
    expect(labelFor({ kind: 'wait', selector: 'text=Export ready' })).toBe('Wait for “Export ready”');
    expect(labelFor({ kind: 'wait', selector: '#a > div.b' })).toBe('Wait for the control');
    expect(labelFor({ kind: 'scroll', selector: 'button[aria-label="Pricing"]' })).toBe('Scroll to “Pricing”');
    expect(labelFor({ kind: 'scroll', selector: '#a > div.b' })).toBe('Scroll to the control');
    expect(labelFor({ kind: 'shot', name: 'after-save' })).toBe('Screenshot “after-save”');
    expect(labelFor({ kind: 'shot', name: 'after-save', label: 'Saved' })).toBe('Saved');
  });
});

async function stateFile(content: string) {
  const file = join(await directory(), 'state.json');
  await writeFile(file, content);
  return file;
}

describe('capture --state', () => {
  useCleanup();

  it('hands the resolved storage state to the driver at launch', async () => {
    stubSession();
    const state = await stateFile(JSON.stringify({ cookies: [], origins: [] }));
    const args = await parseArgs([...argv, '--output', join(await directory(), 'out'), '--state', state]);
    expect(args.state).toBe(state);
    const log = { steps: [] as RawStep[], launches: [] as LaunchOptions[] };
    await capture(args, recordingDriver(log));
    expect(log.launches[0]?.state).toBe(state);
  });

  it('launches without a state when the flag is absent', async () => {
    stubSession();
    const log = { steps: [] as RawStep[], launches: [] as LaunchOptions[] };
    await capture(await parseArgs([...argv, '--output', join(await directory(), 'out')]), recordingDriver(log));
    expect(log.launches[0]).not.toHaveProperty('state');
  });

  it('refuses a missing, non-JSON or non-state file before a browser starts', async () => {
    await expect(parseArgs([...argv, '--state', '/nonexistent/state.json'])).rejects.toThrow(
      '--state: cannot read /nonexistent/state.json',
    );
    await expect(readStateFile(await stateFile('not json'))).rejects.toThrow('is not JSON');
    await expect(readStateFile(await stateFile('[]'))).rejects.toThrow('is not a Playwright storage state');
    await expect(readStateFile(await stateFile('{"token":"x"}'))).rejects.toThrow('is not a Playwright storage state');
    await expect(readStateFile(await stateFile('{"cookies":[]}'))).resolves.toMatch(/state\.json$/);
  });
});

async function fakeBinary() {
  const bin = join(await directory(), 'agent-browser');
  await writeFile(bin, '#!/bin/sh\necho "{\\"success\\":true,\\"data\\":{\\"state\\":\\"$AGENT_BROWSER_STATE\\"}}"\n');
  await chmod(bin, 0o755);
  return bin;
}

describe('agent-browser driver', () => {
  useCleanup();

  it('applies the storage state on the launch command only, so later commands keep the page', async () => {
    const browser = new AgentBrowser('s', await fakeBinary());
    browser.loadState('/tmp/state.json');
    expect(await browser.command(['open', 'about:blank'])).toEqual({ state: '/tmp/state.json' });
    expect(await browser.command(['open', 'https://example.com'])).toEqual({ state: '' });
  });

  it('does the same for AGENT_BROWSER_STATE set in the environment', async () => {
    vi.stubEnv('AGENT_BROWSER_STATE', '/tmp/env-state.json');
    const browser = new AgentBrowser('s', await fakeBinary());
    expect(await browser.command(['open', 'about:blank'])).toEqual({ state: '/tmp/env-state.json' });
    expect(await browser.command(['click', '#a'])).toEqual({ state: '' });
  });

  it('maps scroll to a selector and shots to the CLI, and waits on a ms in the CLI', async () => {
    const command = vi.spyOn(AgentBrowser.prototype, 'command').mockResolvedValue({});
    const driver = agentBrowserDriver();
    await driver.step({ kind: 'scroll', selector: '#pricing' });
    expect(command).toHaveBeenLastCalledWith(['scrollintoview', '#pricing']);
    await driver.step({ kind: 'scroll', direction: 'down', pixels: 300 });
    expect(command).toHaveBeenLastCalledWith(['scroll', 'down', '300']);
    await driver.step({ kind: 'wait', ms: 400 });
    expect(command).toHaveBeenLastCalledWith(['wait', '400']);
    await driver.screenshot?.('/tmp/a.png');
    expect(command).toHaveBeenLastCalledWith(['screenshot', '/tmp/a.png']);
  });
});

function pageAnswering(answers: unknown[]) {
  const send = vi.fn<() => Promise<unknown>>(() => Promise.resolve({ result: { value: answers.shift() ?? false } }));
  return { send, on: () => {}, off: () => {} };
}

describe('selector waits over CDP', () => {
  useCleanup();

  it('polls until the page reports the state, riding out a replaced page', async () => {
    const send = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('Execution context was destroyed'))
      .mockResolvedValueOnce({ result: { value: false } })
      .mockResolvedValueOnce({ result: { value: true } });
    await waitForSelectorOverCdp({ send, on: () => {}, off: () => {} }, '#done', 'visible', 5000);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('names the selector and state when the time runs out', async () => {
    await expect(waitForSelectorOverCdp(pageAnswering([]), '.spinner', 'hidden', 250)).rejects.toThrow(
      '".spinner" was not hidden within 0.25s',
    );
  });

  it('says a non-CSS selector needs the playwright driver', async () => {
    await expect(waitForSelectorOverCdp(pageAnswering(['invalid']), 'text=Save', 'visible', 250)).rejects.toThrow(
      'use the playwright driver',
    );
  });
});
