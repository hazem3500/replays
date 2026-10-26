import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as records from '../src/server/agent-native/records.ts';
import { RenderQueue } from '../src/server/render-queue.ts';
import * as renderer from '../src/server/renderer.ts';
import { startServer, type RunningServer } from '../src/server/start.ts';
import * as tracing from '../src/server/tracing.ts';

const vite = vi.hoisted(() => ({ close: vi.fn(async () => {}), createServer: vi.fn() }));
vi.mock('vite', () => ({ createServer: vite.createServer }));

const directories: string[] = [];
const servers: Array<Server | RunningServer> = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    if ('origin' in server) await server.close().catch(() => {});
    else await new Promise<void>((done) => server.close(() => done()));
  }
  vi.restoreAllMocks();
  vite.close.mockReset();
  vite.createServer.mockReset();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'replays-start-lifecycle-'));
  directories.push(dir);
  const databaseClose = vi.fn(async () => {});
  // Exercise the actual ApplicationRuntime -> ApplicationRecords -> database close chain, without PostgreSQL credentials.
  const applicationRecords = new records.ApplicationRecords({ execute: vi.fn(), close: databaseClose });
  vi.spyOn(records, 'openApplicationRecords').mockResolvedValue(applicationRecords);
  vite.createServer.mockResolvedValue({ middlewares: vi.fn(), close: vite.close });
  return {
    databaseClose,
    options: {
      env: { DATA_DIR: dir, DATABASE_URL: 'postgres://fixture/replays', POSTERS_DISABLED: '1', RENDER_DISABLED: '1' },
      sampleDir: dir,
      port: 0,
      log: () => {},
    },
  };
}

async function occupiedPort() {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return (server.address() as { port: number }).port;
}

describe('startup resource ownership', () => {
  it('releases application records and the prune timer when a TLS file cannot be read', async () => {
    const { options, databaseClose } = await fixture();
    const timers = vi.spyOn(globalThis, 'setInterval');
    const clear = vi.spyOn(globalThis, 'clearInterval');
    await expect(
      startServer({ ...options, env: { ...options.env, TLS_CERT_FILE: join(options.sampleDir, 'missing.pem'), TLS_KEY_FILE: 'unused' } }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(databaseClose).toHaveBeenCalledTimes(1);
    const pruneTimer = timers.mock.results.find((_, i) => timers.mock.calls[i]?.[1] === 6 * 60 * 60_000)?.value;
    expect(pruneTimer).toBeDefined();
    expect(clear).toHaveBeenCalledWith(pruneTimer);
  });

  it('releases records, render queue and dev middleware after a real listen failure, preserving EADDRINUSE', async () => {
    const { options, databaseClose } = await fixture();
    const port = await occupiedPort();
    vi.spyOn(renderer, 'detectRenderTools').mockResolvedValue({ available: true, ffmpegPath: 'unused' });
    const queueClose = vi.spyOn(RenderQueue.prototype, 'close');
    databaseClose.mockRejectedValueOnce(new Error('database cleanup failed'));
    vite.close.mockRejectedValueOnce(new Error('dev cleanup failed'));
    await expect(startServer({ ...options, port, dev: true })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(databaseClose).toHaveBeenCalledTimes(1);
    expect(queueClose).toHaveBeenCalledTimes(1);
    expect(vite.close).toHaveBeenCalledTimes(1);
    // The occupied listener belongs to the host and must remain open.
    expect((servers[0] as Server).listening).toBe(true);
    expect(vite.createServer.mock.calls[0]?.[0].server.hmr.server.listening).toBe(false);
  });

  it('closes an already listening server when the final startup log throws', async () => {
    const { options, databaseClose } = await fixture();
    const failure = new Error('startup logger failed');
    await expect(
      startServer({
        ...options,
        dev: true,
        log: (line) => {
          if (line.includes(' listening on ')) throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(databaseClose).toHaveBeenCalledTimes(1);
    expect(vite.close).toHaveBeenCalledTimes(1);
    expect(vite.createServer.mock.calls[0]?.[0].server.hmr.server.listening).toBe(false);
  });

  it('keeps successful close idempotent and reports every cleanup failure in an AggregateError', async () => {
    const { options, databaseClose } = await fixture();
    vi.spyOn(renderer, 'detectRenderTools').mockResolvedValue({ available: true, ffmpegPath: 'unused' });
    vi.spyOn(tracing, 'tracingEnabled').mockReturnValueOnce(false).mockReturnValue(true);
    vi.spyOn(tracing, 'initTracing').mockResolvedValue('fixture tracing');
    const shutdown = vi.spyOn(tracing, 'shutdownTracing');
    const server = await startServer({ ...options, dev: true });
    servers.push(server);
    const queueFailure = new Error('queue cleanup failed');
    const databaseFailure = new Error('database cleanup failed');
    const devFailure = new Error('dev cleanup failed');
    const tracingFailure = new Error('tracing cleanup failed');
    vi.spyOn(RenderQueue.prototype, 'close').mockRejectedValueOnce(queueFailure);
    databaseClose.mockRejectedValueOnce(databaseFailure);
    vite.close.mockImplementationOnce(() => {
      throw devFailure;
    });
    shutdown.mockRejectedValueOnce(tracingFailure);
    const closing = server.close();
    expect(server.close()).toBe(closing);
    await expect(closing).rejects.toMatchObject({
      message: 'server shutdown cleanup failed',
      errors: [queueFailure, databaseFailure, devFailure, tracingFailure],
    });
    expect(server.server.listening).toBe(false);
    expect(databaseClose).toHaveBeenCalledTimes(1);
    expect(vite.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    { alreadyEnabled: false, failStartup: false },
    { alreadyEnabled: true, failStartup: false },
    { alreadyEnabled: false, failStartup: true },
    { alreadyEnabled: true, failStartup: true },
  ])('respects tracing ownership ($alreadyEnabled, startup failure $failStartup)', async ({ alreadyEnabled, failStartup }) => {
    const { options } = await fixture();
    vi.spyOn(tracing, 'tracingEnabled').mockReturnValueOnce(alreadyEnabled).mockReturnValue(true);
    vi.spyOn(tracing, 'initTracing').mockResolvedValue('fixture tracing');
    const shutdown = vi.spyOn(tracing, 'shutdownTracing').mockResolvedValue();
    if (failStartup) {
      await expect(startServer({ ...options, port: await occupiedPort() })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } else {
      const server = await startServer(options);
      servers.push(server);
      await server.close();
    }
    expect(shutdown).toHaveBeenCalledTimes(alreadyEnabled ? 0 : 1);
  });
});
