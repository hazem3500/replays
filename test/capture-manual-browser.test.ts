import { readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { capture, createDriver, parseArgs } from '../src/capture/capture.ts';
import type { CdpLike } from '../src/capture/session.ts';
import { assertReplayBundle, type ReplayBundle } from '../src/shared/replay.ts';
import { startDemoServer } from '../scripts/demo-server.mjs';

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const found = readdirSync('/usr/bin').find((name) => /^(\w+-)?chrom(e|ium)(-stable|-browser)?$/.test(name));
  return found ? `/usr/bin/${found}` : undefined;
}

const CHROME = findChrome();

describe.skipIf(!CHROME)('a manual capture in a real browser', () => {
  let demo: { server: Server; origin: string };
  let output = '';
  let bundle: ReplayBundle;
  const saved = { chrome: process.env.CHROME_PATH, sandbox: process.env.CHROMIUM_NO_SANDBOX };

  beforeAll(async () => {
    process.env.CHROME_PATH = CHROME!;
    process.env.CHROMIUM_NO_SANDBOX ??= '1';
    demo = (await startDemoServer(0)) as typeof demo;
    output = join(await mkdtemp(join(tmpdir(), 'replays-manual-browser-')), 'out');
    const args = await parseArgs(['--url', `${demo.origin}/`, '--headed', '--manual', '--output', output, '--id', 'manual-take']);
    const real = createDriver(args.driver, { headed: false });
    let cdp: CdpLike | undefined;
    const driver = {
      ...real,
      launch: async (options: Parameters<typeof real.launch>[0]) => (cdp = await real.launch(options)),
    };
    const result = await capture(args, driver, {
      onRecording: () => {
        void (async () => {
          await real.step({ kind: 'click', selector: "button[data-id='tea']" });
          await real.wait(1200);
          await real.step({ kind: 'click', selector: "nav a[href='/checkout.html']" });
          await real.wait(1500);
          await cdp?.send('Page.close');
        })();
      },
    });
    bundle = JSON.parse(await readFile(result.replayPath, 'utf8')) as ReplayBundle;
  }, 60_000);

  afterAll(async () => {
    demo?.server.close();
    if (output) await rm(join(output, '..'), { recursive: true, force: true });
    for (const [name, value] of [
      ['CHROME_PATH', saved.chrome],
      ['CHROMIUM_NO_SANDBOX', saved.sandbox],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('saves a valid replay when the page is closed by the person', () => {
    expect(() => assertReplayBundle(bundle)).not.toThrow();
    expect(bundle.events.length).toBeGreaterThan(5);
  });

  it("names the person's clicks and the page they opened, with no selectors", () => {
    const labels = bundle.steps.map((step) => step.label);
    expect(labels[0]).toBe(`Open ${new URL(demo.origin).hostname}`);
    expect(labels.some((label) => label.startsWith('Clicked'))).toBe(true);
    expect(labels.some((label) => label.startsWith('Opened'))).toBe(true);
    expect(bundle.steps.slice(1).every((step) => step.auto === true && step.selector === undefined)).toBe(true);
  });

  it('keeps the network record', () => {
    expect(bundle.network.length).toBeGreaterThan(0);
  });
});
