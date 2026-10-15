// Starts the production server on a free port with AUTH_MODE=none and a
// throwaway DATA_DIR. Shared by the Playwright specs and `pnpm shots`.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

export function freePort() {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

async function waitForHealth(origin, child, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    const ok = await fetch(origin)
      .then((response) => response.ok)
      .catch(() => false);
    if (ok) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`server did not answer GET / within ${timeoutMs} ms`);
}

/**
 * `capture`: keep the server's stdout and stderr (the last ~64 KB) for `output()`, so a test can attach the
 * server's own account (list media logs a line per job, failures included) when it fails. Stderr still
 * reaches the console.
 */
export async function startServer({ env = {}, capture = false } = {}) {
  const port = await freePort();
  const dataDir = await mkdtemp(join(tmpdir(), 'replays-e2e-'));
  const child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', 'src/server/main.ts'], {
    cwd: root,
    env: { ...process.env, AUTH_MODE: 'none', PORT: String(port), DATA_DIR: dataDir, ...env },
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'ignore', 'inherit'],
  });
  let output = '';
  const keep = (chunk) => {
    output = (output + chunk.toString()).slice(-65_536);
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', (chunk) => {
    keep(chunk);
    process.stderr.write(chunk);
  });
  const origin = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(origin, child);
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
  return {
    origin,
    dataDir,
    output: () => output,
    async stop() {
      if (child.exitCode === null) {
        const exited = new Promise((done) => child.once('exit', done));
        child.kill('SIGTERM');
        await Promise.race([exited, new Promise((done) => setTimeout(done, 3000))]);
        if (child.exitCode === null) child.kill('SIGKILL');
      }
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
