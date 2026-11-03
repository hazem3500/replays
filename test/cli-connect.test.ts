import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { replay } from './fixtures.ts';
import { normalizeServerUrl, normalizeUploadUrl, resolveUploadEndpoint } from '../src/capture/server-config.ts';

const root = resolve(import.meta.dirname, '..');
const bins: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
  await Promise.all(bins.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempDir() {
  const path = await mkdtemp(join(tmpdir(), 'replays-cli-connect-'));
  bins.push(path);
  return path;
}

function run(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn(process.execPath, [join(root, 'bin/replays.mjs'), ...args], { cwd: root, env });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => done({ code: code ?? 1, stdout, stderr }));
  });
}

async function listen(handler: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('loopback server did not bind');
  return { base: `http://127.0.0.1:${address.port}`, server };
}

// why: a test spawns the CLI up to seven times in a row; on a busy two-core CI runner that exceeds the 5 s default.
describe('installed CLI server setup', { timeout: 31_000 }, () => {
  it('saves a private default, checks a base path, and uploads with saved target plus caller credentials', async () => {
    const dataDir = await tempDir();
    const received: Array<{ path: string; authorization?: string; body?: string }> = [];
    const local = await listen((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received.push({
          path: request.url ?? '',
          ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
          body: Buffer.concat(chunks).toString('utf8'),
        });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(request.url?.endsWith('/api/config') ? '{"auth":"oidc"}' : '{"id":"ok"}');
      });
    });
    const env = { ...process.env, XDG_CONFIG_HOME: dataDir, REPLAYS_SERVER_URL: '', REPLAYS_SERVER: '' };
    const connect = await run(['connect', `${local.base}/workspace/`], env);
    expect(connect.code).toBe(0);
    expect(JSON.parse(connect.stdout)).toMatchObject({ success: true, server: `${local.base}/workspace`, default: true });
    const saved = join(dataDir, 'replays', 'config.json');
    const config = JSON.parse(await readFile(saved, 'utf8')) as { servers: Record<string, { url: string }> };
    expect(config.servers.default?.url).toBe(`${local.base}/workspace`);
    expect((await stat(saved)).mode & 0o777).toBe(0o600);

    const doctor = await run(['doctor'], env);
    expect(doctor.code).toBe(0);
    expect(JSON.parse(doctor.stdout)).toMatchObject({ reachable: true, uploadEndpoint: `${local.base}/workspace/api/replays` });
    const replayPath = join(dataDir, 'replay.json');
    const headerPath = join(dataDir, 'headers.json');
    await writeFile(replayPath, JSON.stringify(replay('saved-target')));
    await writeFile(headerPath, JSON.stringify({ authorization: 'Bearer test-only' }), { mode: 0o600 });
    const upload = await run(['upload', replayPath, '--header-file', headerPath], env);
    expect(upload.code).toBe(0);
    expect(JSON.parse(upload.stdout)).toEqual({ success: true, id: 'saved-target' });
    expect(received.map((item) => item.path)).toEqual(['/workspace/api/cli/auth/capabilities', '/workspace/api/replays']);
    expect(received[1]).toMatchObject({ authorization: 'Bearer test-only' });
    expect(JSON.parse(received[1]!.body!).meta.id).toBe('saved-target');
    expect(await readFile(saved, 'utf8')).not.toContain('test-only');

    const named = await run(['connect', `${local.base}/staging`, '--name', 'staging'], env);
    expect(named.code).toBe(0);
    const listing = await run(['config'], env);
    expect(JSON.parse(listing.stdout)).toMatchObject({
      defaultServer: 'staging',
      servers: [
        { name: 'default', url: `${local.base}/workspace` },
        { name: 'staging', url: `${local.base}/staging` },
      ],
    });
    const namedDoctor = await run(['doctor', '--server', 'default'], env);
    expect(namedDoctor.code).toBe(0);
    expect(JSON.parse(namedDoctor.stdout).server).toBe(`${local.base}/workspace`);

    const reset = await run(['config', 'reset'], env);
    expect(reset.code).toBe(0);
    expect(JSON.parse(reset.stdout)).toEqual({ success: true, reset: true });
  });

  it('prefers --upload-url over configured and environment server URLs', async () => {
    const dataDir = await tempDir();
    let savedRequests = 0;
    const saved = await listen((_request, response) => {
      savedRequests += 1;
      response.writeHead(200).end('{}');
    });
    let environmentRequests = 0;
    const environment = await listen((_request, response) => {
      environmentRequests += 1;
      response.writeHead(200).end('{}');
    });
    const explicitPaths: string[] = [];
    let explicitAuthorization: string | undefined;
    const explicit = await listen((request, response) => {
      explicitPaths.push(request.url ?? '');
      explicitAuthorization = request.headers.authorization;
      response.writeHead(200).end('{}');
    });
    const env = { ...process.env, XDG_CONFIG_HOME: dataDir, REPLAYS_SERVER_URL: environment.base, REPLAYS_SERVER: '' };
    await run(['connect', `${saved.base}/saved`], env);
    const replayPath = join(dataDir, 'replay.json');
    const headerPath = join(dataDir, 'headers.json');
    await writeFile(replayPath, JSON.stringify(replay('explicit')));
    await writeFile(headerPath, JSON.stringify({ authorization: 'Bearer confined' }), { mode: 0o600 });
    const trustedTarget = `${explicit.base}/custom/upload`;
    const result = await run(['upload', replayPath, '--upload-url', trustedTarget, '--header-file', headerPath], env);
    expect(result.code).toBe(0);
    expect(explicitPaths).toEqual(['/custom/upload']);
    expect(explicitAuthorization).toBe('Bearer confined');
    expect(savedRequests).toBe(0);
    expect(environmentRequests).toBe(0);
    const named = await run(['upload', replayPath, '--server', 'default', '--header-file', headerPath], env);
    expect(named.code).toBe(0);
    expect(savedRequests).toBe(1);
    expect(environmentRequests).toBe(0);
    const envSelected = await run(['upload', replayPath, '--header-file', headerPath], env);
    expect(envSelected.code).toBe(0);
    expect(environmentRequests).toBe(1);
    await expect(resolveUploadEndpoint({ trustedUploadUrl: trustedTarget, path: saved.base })).resolves.toBe(trustedTarget);
    await expect(
      resolveUploadEndpoint({ explicitUploadUrl: trustedTarget, trustedUploadUrl: trustedTarget, path: saved.base }),
    ).resolves.toBe(trustedTarget);
    await expect(
      resolveUploadEndpoint({ explicitUploadUrl: `${saved.base}/saved/api/replays`, trustedUploadUrl: trustedTarget }),
    ).rejects.toThrow('does not match the trusted upload endpoint');
  });

  it('gives actionable auth errors and refuses auth redirects', async () => {
    const dataDir = await tempDir();
    const denied = await listen((_request, response) => response.writeHead(403).end('sensitive server response'));
    const env = { ...process.env, XDG_CONFIG_HOME: dataDir, REPLAYS_SERVER_URL: '', REPLAYS_SERVER: '' };
    await run(['connect', denied.base], env);
    const replayPath = join(dataDir, 'replay.json');
    await writeFile(replayPath, JSON.stringify(replay('denied')));
    const failure = await run(['upload', replayPath], env);
    expect(failure.code).toBe(1);
    const error = JSON.parse(failure.stderr).error as string;
    expect(error).toContain('refused (403)');
    expect(error).toContain('--header-file');
    expect(error).not.toContain('sensitive server response');

    const redirect = await listen((_request, response) =>
      response.writeHead(302, { location: 'https://identity.example.test/login' }).end(),
    );
    const redirected = await run(['upload', replayPath, '--upload-url', `${redirect.base}/api/replays`], env);
    expect(JSON.parse(redirected.stderr).error).toContain('was redirected');
  });

  it('rejects URLs that could embed credentials or vary the target with query data', () => {
    for (const value of ['http://replays.example.test', 'http://192.168.1.10:8080']) {
      expect(() => normalizeServerUrl(value)).toThrow(/must use HTTPS except on loopback/);
      expect(() => normalizeUploadUrl(`${value}/api/replays`)).toThrow(/must use HTTPS except on loopback/);
    }
    for (const value of ['https://user:pass@example.com', 'https://example.com/?token=secret', 'https://example.com/#fragment']) {
      expect(() => normalizeServerUrl(value)).toThrow(/must not include credentials/);
      expect(() => normalizeUploadUrl(value)).toThrow(/must not include credentials/);
    }
  });
});
