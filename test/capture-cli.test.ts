import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createPullGate,
  defaultId,
  normalizeConsole,
  normalizePerformance,
  prepareOutputDirectory,
  validateSteps,
} from '../src/capture/capture.ts';
import { buildReplayContext, readContextFile } from '../src/capture/context.ts';

describe('capture metadata', () => {
  it('makes same-host, same-second default ids unique', () => {
    const now = new Date('2026-10-06T07:56:48.000Z');
    const first = defaultId('https://example.com/path', now, 'a1b2c3');
    const second = defaultId('https://example.com/path', now, 'd4e5f6');

    expect(first).toBe('example-com-2026-10-06-075648-a1b2c3');
    expect(second).toBe('example-com-2026-10-06-075648-d4e5f6');
    expect(first).not.toBe(second);
  });

  it('redacts console track URLs and keeps entries on the replay clock', () => {
    expect(
      normalizeConsole(
        [
          { at: 1000, level: 'info', message: 'ready', url: 'https://example.com/?token=recorder-secret' },
          { at: 1200, level: 'error', message: 'Request failed', url: 'https://example.com/?token=console-secret' },
        ],
        1000,
      ),
    ).toEqual([
      { at: 0, level: 'info', message: 'ready', url: 'https://example.com/?token=%5Bredacted%5D' },
      { at: 200, level: 'error', message: 'Request failed', url: 'https://example.com/?token=%5Bredacted%5D' },
    ]);
  });

  it('redacts sensitive URLs inside console message text', () => {
    const [entry] = normalizeConsole(
      [{ at: 1, level: 'error', message: 'GET https://api.example.com/me?api_token=message-secret 401' }],
      0,
    );
    expect(entry!.message).toBe('GET https://api.example.com/me?api_token=%5Bredacted%5D 401');
  });

  it('normalizes only bounded, content-free performance timings onto the replay clock', () => {
    const entries = normalizePerformance(
      [
        { at: 900, kind: 'first-contentful-paint', value: 900 },
        { at: 1200, kind: 'slow-interaction', value: 82, eventType: 'click', target: 'secret text' } as never,
        { at: 1300, kind: 'slow-interaction', value: 90, eventType: 'click', url: 'https://example.com/?token=secret' } as never,
        { at: 1400, kind: 'slow-interaction', value: 60, eventType: 'unknown' },
      ],
      1000,
    );

    expect(entries).toEqual([
      { at: 0, kind: 'first-contentful-paint', value: 900 },
      { at: 200, kind: 'slow-interaction', value: 82, eventType: 'click' },
      { at: 300, kind: 'slow-interaction', value: 90, eventType: 'click' },
    ]);
    expect(JSON.stringify(entries)).not.toContain('secret');
    expect(
      normalizePerformance(
        Array.from({ length: 600 }, (_, index) => ({ at: index, kind: 'long-task', value: 50 })),
        0,
      ),
    ).toHaveLength(500);
  });

  it('validates steps before capture starts', () => {
    expect(
      validateSteps([
        { kind: 'click', selector: '[data-testid="save"]' },
        { kind: 'fill', selector: '#name', text: '' },
        { kind: 'wait', ms: 250 },
        { kind: 'goto', url: 'https://example.com/next' },
      ]),
    ).toHaveLength(4);

    expect(() => validateSteps([{ kind: 'click' }])).toThrow('--steps[0].selector');
    expect(() => validateSteps([{ kind: 'unknown' }])).toThrow('--steps[0].kind is unsupported');
    expect(() => validateSteps([{ kind: 'goto', url: 'http://example.com' }])).toThrow('--steps[0].url must use https');
  });

  it('accepts a selector wait with a state and timeout, a scroll to a selector and a shot', () => {
    expect(
      validateSteps([
        { kind: 'wait', selector: '#done' },
        { kind: 'wait', selector: '.spinner', state: 'hidden', timeout: 60_000, label: 'Wait for the export' },
        { kind: 'wait', ms: 250 },
        { kind: 'scroll', selector: '#pricing' },
        { kind: 'scroll', direction: 'down', pixels: 300 },
        { kind: 'shot', name: 'after-save', label: 'Saved' },
      ]),
    ).toEqual([
      { kind: 'wait', selector: '#done' },
      { kind: 'wait', selector: '.spinner', state: 'hidden', timeout: 60_000, label: 'Wait for the export' },
      { kind: 'wait', ms: 250 },
      { kind: 'scroll', selector: '#pricing' },
      { kind: 'scroll', direction: 'down', pixels: 300 },
      { kind: 'shot', name: 'after-save', label: 'Saved' },
    ]);
  });

  it.each([
    [{ kind: 'wait', selector: '#a', ms: 5 }, 'waits for a selector or ms, not both'],
    [{ kind: 'wait', ms: 5, state: 'hidden' }, 'state and timeout need a selector'],
    [{ kind: 'wait', ms: 5, timeout: 1000 }, 'state and timeout need a selector'],
    [{ kind: 'wait', selector: '#a', state: 'gone' }, '--steps[0].state must be visible, attached, hidden'],
    [{ kind: 'wait', selector: '#a', timeout: 0 }, 'between 1 and 300000'],
    [{ kind: 'wait', selector: '#a', timeout: 300_001 }, 'between 1 and 300000'],
    [{ kind: 'wait', selector: '' }, '--steps[0].selector must be a non-empty string'],
    [{ kind: 'wait' }, '--steps[0].ms must be a non-negative number'],
    [{ kind: 'scroll', selector: '#a', direction: 'down' }, 'scrolls to a selector or by direction, not both'],
    [{ kind: 'scroll', selector: '#a', pixels: 10 }, 'scrolls to a selector or by direction, not both'],
    [{ kind: 'shot' }, '--steps[0].name must be a non-empty string'],
    [{ kind: 'shot', name: 'Bad Name' }, 'lowercase letters, digits and hyphens'],
    [{ kind: 'shot', name: 'x'.repeat(65) }, 'lowercase letters, digits and hyphens'],
  ])('refuses the step %j', (step, message) => {
    expect(() => validateSteps([step])).toThrow(message);
  });

  it('refuses a shot name used twice, which would overwrite the first PNG', () => {
    expect(() =>
      validateSteps([
        { kind: 'shot', name: 'before' },
        { kind: 'shot', name: 'before' },
      ]),
    ).toThrow('--steps[1].name repeats an earlier shot: before');
  });

  it('refuses a non-empty output directory before capture starts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replays-output-'));
    const output = join(root, 'capture');
    await expect(prepareOutputDirectory(output)).resolves.toBeUndefined();
    await writeFile(join(output, 'replay.json'), '{}');

    await expect(prepareOutputDirectory(output)).rejects.toThrow(`--output directory must be empty: ${output}`);
  });

  it('runs a final pull after an in-flight pull instead of dropping it', async () => {
    const calls: boolean[] = [];
    let resumeInFlight!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      resumeInFlight = resolve;
    });
    const pull = createPullGate(async (final) => {
      calls.push(final);
      if (calls.length === 1) await inFlight;
    });

    const first = pull(false);
    const final = pull(true);
    pull(false);
    expect(calls).toEqual([false]);
    resumeInFlight();
    await first;
    await final;
    expect(calls).toEqual([false, true]);
  });

  it('rejects an invalid context file before a capture starts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replays-context-'));
    const file = join(root, 'context.json');
    await writeFile(file, JSON.stringify({ environment: 'staging', accessToken: 'secret' }));
    const parsed = await readContextFile(file);
    expect(() => buildReplayContext(parsed, '2026-10-06T00:00:00.000Z')).toThrow(/unsupported keys: environment, accessToken/);
    await writeFile(file, 'x'.repeat(20_000));
    await expect(readContextFile(file)).rejects.toThrow(/at most 16 KB/);
    await expect(readContextFile(undefined)).resolves.toBeUndefined();
  });

  it('runs every later pull once the previous one has settled', async () => {
    const calls: boolean[] = [];
    const pull = createPullGate(async (final) => {
      calls.push(final);
    });

    await pull();
    await pull();
    await pull(true);
    expect(calls).toEqual([false, false, true]);
  });

  it('accepts new pulls after a failed pull', async () => {
    const calls: boolean[] = [];
    const pull = createPullGate(async (final) => {
      calls.push(final);
      if (calls.length === 1) throw new Error('page closed');
    });

    await expect(pull()).rejects.toThrow('page closed');
    await pull(true);
    expect(calls).toEqual([false, true]);
  });
});
