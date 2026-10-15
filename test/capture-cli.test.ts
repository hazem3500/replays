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
