import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { capture, parseArgs } from '../src/capture/capture.ts';
import { DEFAULT_PROFILE_IDS, unknownProfileWarning } from '../src/capture/capture-settings.ts';
import type { CaptureDriver } from '../src/capture/drivers/types.ts';
import { RecorderSession } from '../src/capture/session.ts';

const roots: string[] = [];
const argv = ['--url', 'https://example.com', '--output', '/tmp/replays-unused'];

const cleanUp = async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
};

async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'replays-network-'));
  roots.push(root);
  return root;
}

function fakeDriver(recordsBodies?: true): CaptureDriver {
  return {
    name: 'fake',
    ...(recordsBodies ? { recordsBodies } : {}),
    launch: async ({ harPath }) => {
      await writeFile(harPath, JSON.stringify({ log: { entries: [] } }));
      return { send: () => Promise.resolve({}), on: () => {}, off: () => {} };
    },
    open: () => Promise.resolve(),
    step: () => Promise.resolve(),
    wait: () => Promise.resolve(),
    finish: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}

const collect = (into: string[]) => (chunk: string | Uint8Array) => {
  into.push(String(chunk));
  return true;
};

function stubSession() {
  const tracks = { origin: 1000, duration: 1000, events: [{ type: 2, timestamp: 1000 }], console: [], performance: undefined };
  const session = { flush: () => Promise.resolve(), stop: () => Promise.resolve(tracks), dispose: () => {} };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- why: capture() only calls flush, stop and dispose on the session.
  vi.spyOn(RecorderSession, 'start').mockResolvedValue(session as unknown as RecorderSession);
}

describe('--network bodies on a driver that cannot record them', () => {
  afterEach(cleanUp);

  it('says what was requested and what was recorded', async () => {
    stubSession();
    const warnings: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(collect(warnings));
    const args = await parseArgs([...argv, '--output', join(await directory(), 'out'), '--network', 'bodies']);
    const result = await capture(args, fakeDriver());
    expect(result).toMatchObject({ networkRequested: 'bodies', networkMode: 'headers' });
    expect(warnings.join('')).toContain('--network bodies was requested but the fake driver cannot record bodies');
  });

  it('reports bodies when the driver records them, and off when asked for off', async () => {
    stubSession();
    const bodies = await capture(
      await parseArgs([...argv, '--output', join(await directory(), 'a'), '--network', 'bodies']),
      fakeDriver(true),
    );
    expect(bodies).toMatchObject({ networkRequested: 'bodies', networkMode: 'bodies' });
    const off = await capture(await parseArgs([...argv, '--output', join(await directory(), 'b'), '--network', 'off']), fakeDriver());
    expect(off).toMatchObject({ networkRequested: 'off', networkMode: 'off' });
  });
});

describe('--profile warnings', () => {
  afterEach(cleanUp);

  it.each(DEFAULT_PROFILE_IDS)('accepts %s without a declaration', (id) => {
    expect(unknownProfileWarning(id, {})).toBeUndefined();
  });

  it('accepts a declared id and the built-in performance profile', () => {
    expect(unknownProfileWarning('nightly', { config: [{ id: 'nightly', label: 'Nightly' }] })).toBeUndefined();
    expect(unknownProfileWarning('performance', {})).toBeUndefined();
  });

  it('warns only for an unknown id, with the ids to use instead', () => {
    const warning = unknownProfileWarning('triag', { config: [{ id: 'nightly', label: 'Nightly' }] });
    expect(warning).toContain('profile triag is not declared; declare it in replays.config.* or use one of:');
    expect(warning).toContain('nightly');
    expect(warning).toContain('triage, design-review, walkthrough, support');
  });

  it('parseArgs stays silent for a built-in id', async () => {
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(collect(written));
    await parseArgs([...argv, '--profile', 'triage']);
    expect(written.join('')).not.toContain('not declared');
  });
});
