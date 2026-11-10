import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app.ts';
import { oidcAuth } from '../src/server/auth/oidc.ts';
import { ReplayStore } from '../src/server/store.ts';
import { beginDeviceLogin, CliAuthError } from '../src/capture/device-auth.ts';
import { appDefaults, replay } from './fixtures.ts';

const root = resolve(import.meta.dirname, '..');
const servers: Server[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const b64 = (value: Buffer | string) => Buffer.from(value).toString('base64url');
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'device-key', use: 'sig', alg: 'RS256' };

function token(issuer: string, tokenId = 'device-access') {
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'RS256', kid: 'device-key', typ: 'JWT' }));
  const payload = b64(
    JSON.stringify({
      iss: issuer,
      aud: 'https://viewer.example.test/workspace',
      sub: 'device-user',
      email: 'cli@example.test',
      scope: 'openid email profile replays:upload',
      jti: tokenId,
      iat: now,
      exp: now + 300,
    }),
  );
  return `${header}.${payload}.${b64(sign('sha256', Buffer.from(`${header}.${payload}`), pair.privateKey))}`;
}

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return { origin: `http://127.0.0.1:${address.port}`, server };
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

describe('OIDC device login and upload-only CLI session', () => {
  it('stops on provider denial before returning an access token', async () => {
    const provider = await listen((request, response) => {
      const path = new URL(request.url ?? '/', 'http://provider').pathname;
      if (path === '/device') {
        response.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            device_code: 'private-device-code',
            user_code: 'DENY-1234',
            verification_uri: `${provider.origin}/activate`,
            expires_in: 60,
            interval: 0.01,
          }),
        );
      } else if (path === '/token') {
        response.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"access_denied"}');
      } else response.writeHead(404).end();
    });
    const capability = {
      type: 'oidc-device' as const,
      issuer: provider.origin,
      clientId: 'public-client',
      audience: 'replays-api',
      deviceAuthorizationEndpoint: `${provider.origin}/device`,
      tokenEndpoint: `${provider.origin}/token`,
      resource: provider.origin,
      scopes: ['openid', 'email', 'profile', 'replays:upload'] as const,
    };
    await expect(beginDeviceLogin(provider.origin, capability)).rejects.toMatchObject({
      message: 'sign-in was denied; no upload was attempted',
      exitCode: 4,
    } satisfies Partial<CliAuthError>);
  });

  it('approves through the provider, reuses the saved token, and never sends it to an explicit different endpoint', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'replays-device-cli-'));
    directories.push(configDir);
    const deviceSecret = 'private-device-code-do-not-print';
    const accessSecret = 'private-access-token-do-not-print';
    let polls = 0;
    let refreshes = 0;
    let activeRefreshToken = accessSecret;
    let raceRefreshes = false;
    let concurrentRotationSaved = false;
    let credentialPathForRefresh: string | undefined;
    const pendingRefreshResponses: ServerResponse[] = [];
    let requestedResource: string | null = null;
    let issuedAccessToken = '';
    let holdNextUploadFor401 = false;
    let heldUploadAuthorization: string | undefined;
    let heldUploadReachedResolve: (() => void) | undefined;
    let releaseHeldUpload: (() => void) | undefined;
    const revocations: URLSearchParams[] = [];
    const provider = await listen((request, response) => {
      void (async () => {
        const url = new URL(request.url ?? '/', 'http://provider');
        const issuer = `http://127.0.0.1:${(provider.server.address() as { port: number }).port}`;
        if (url.pathname === '/.well-known/openid-configuration') {
          response.writeHead(200, { 'content-type': 'application/json' }).end(
            JSON.stringify({
              issuer,
              authorization_endpoint: `${issuer}/authorize`,
              token_endpoint: `${issuer}/token`,
              jwks_uri: `${issuer}/jwks`,
              device_authorization_endpoint: `${issuer}/device`,
              revocation_endpoint: `${issuer}/revoke`,
            }),
          );
          return;
        }
        if (url.pathname === '/jwks') {
          response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [publicJwk] }));
          return;
        }
        if (url.pathname === '/device' && request.method === 'POST') {
          let body = '';
          for await (const chunk of request) body += chunk;
          requestedResource = new URLSearchParams(body).get('resource');
          response.writeHead(200, { 'content-type': 'application/json' }).end(
            JSON.stringify({
              device_code: deviceSecret,
              user_code: 'RPLS-1234',
              verification_uri: `${issuer}/activate`,
              verification_uri_complete: `${issuer}/activate?device_code=${encodeURIComponent(deviceSecret)}`,
              expires_in: 60,
              interval: 0.01,
            }),
          );
          return;
        }
        if (url.pathname === '/token' && request.method === 'POST') {
          let body = '';
          for await (const chunk of request) body += chunk;
          const form = new URLSearchParams(body);
          if (form.get('grant_type') === 'refresh_token') {
            const presentedRefreshToken = form.get('refresh_token');
            if (presentedRefreshToken !== activeRefreshToken) {
              response.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"invalid_grant"}');
              return;
            }
            refreshes += 1;
            if (raceRefreshes) {
              pendingRefreshResponses.push(response);
              if (pendingRefreshResponses.length === 2) {
                raceRefreshes = false;
                const [winner, stale] = pendingRefreshResponses.splice(0, 2);
                const rotatedRefreshToken = `${presentedRefreshToken}-raced`;
                activeRefreshToken = rotatedRefreshToken;
                winner!.writeHead(200, { 'content-type': 'application/json' }).end(
                  JSON.stringify({
                    access_token: token(issuer, `refresh-${refreshes}`),
                    refresh_token: rotatedRefreshToken,
                    token_type: 'Bearer',
                    expires_in: 300,
                    scope: 'openid email profile replays:upload',
                  }),
                );
                const deadline = Date.now() + 5_000;
                const credentialFileForRefresh = credentialPathForRefresh;
                if (credentialFileForRefresh) {
                  while (Date.now() < deadline) {
                    try {
                      const saved = JSON.parse(await readFile(credentialFileForRefresh, 'utf8')) as { refreshToken?: string };
                      if (saved.refreshToken === rotatedRefreshToken) {
                        concurrentRotationSaved = true;
                        break;
                      }
                    } catch {
                      // Wait for the winning CLI process to atomically replace its credential file.
                    }
                    await new Promise((done) => setTimeout(done, 10));
                  }
                }
                stale!.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"invalid_grant"}');
              }
              return;
            }
            const rotatedRefreshToken = `${presentedRefreshToken}-rotated`;
            activeRefreshToken = rotatedRefreshToken;
            response.writeHead(200, { 'content-type': 'application/json' }).end(
              JSON.stringify({
                access_token: token(issuer, `refresh-${refreshes}`),
                refresh_token: rotatedRefreshToken,
                token_type: 'Bearer',
                expires_in: 300,
                scope: 'openid email profile replays:upload',
              }),
            );
            return;
          }
          if (form.get('device_code') !== deviceSecret) {
            response.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"invalid_grant"}');
            return;
          }
          polls += 1;
          if (polls === 1) {
            response.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"authorization_pending"}');
            return;
          }
          response.writeHead(200, { 'content-type': 'application/json' }).end(
            JSON.stringify({
              access_token: (issuedAccessToken = token(issuer)),
              refresh_token: accessSecret,
              token_type: 'Bearer',
              expires_in: 300,
              scope: 'openid email profile replays:upload',
            }),
          );
          return;
        }
        if (url.pathname === '/revoke') {
          let body = '';
          for await (const chunk of request) body += chunk;
          revocations.push(new URLSearchParams(body));
          response.writeHead(200).end();
          return;
        }
        response.writeHead(404).end();
      })();
    });
    const issuer = provider.origin;
    const storeRoot = join(configDir, 'store');
    const store = new ReplayStore(join(storeRoot, 'data'), join(storeRoot, 'sample'));
    const handler = createApp({
      ...appDefaults(),
      auth: oidcAuth({
        issuer,
        clientId: 'replays-cli-public',
        audience: 'https://viewer.example.test/workspace',
        sessionSecret: 'device-flow-test-session-secret',
        publicOrigin: 'https://viewer.example.test',
        deviceFlow: true,
      }),
      store,
      clientDir: join(storeRoot, 'client'),
      basePath: '/workspace',
    });
    let acceptedAuthorization: string | undefined;
    const viewer = await listen((request, response) => {
      if (request.method === 'POST' && request.url?.endsWith('/api/replays')) {
        acceptedAuthorization = request.headers.authorization;
        if (holdNextUploadFor401) {
          holdNextUploadFor401 = false;
          heldUploadAuthorization = request.headers.authorization;
          const released = new Promise<void>((done) => {
            releaseHeldUpload = done;
          });
          void (async () => {
            for await (const _chunk of request) {
              // Consume the request body before releasing the stale response.
            }
            heldUploadReachedResolve?.();
            await released;
            response.writeHead(401, { 'content-type': 'text/plain' }).end('stale upload token');
          })();
          return;
        }
      }
      void handler(request, response);
    });
    const env = {
      ...process.env,
      XDG_CONFIG_HOME: configDir,
      REPLAYS_CREDENTIAL_STORE: 'file',
      REPLAYS_SERVER_URL: '',
      REPLAYS_SERVER: '',
    };
    const connect = await run(['connect', `${viewer.origin}/workspace`], env);
    expect(connect.code).toBe(0);
    const replayFile = join(configDir, 'replay.json');
    await writeFile(replayFile, JSON.stringify(replay('device-upload')));
    const noninteractive = await run(['upload', replayFile], env);
    expect(noninteractive.code).toBe(3);
    expect(noninteractive.stderr).toContain('replays login');
    expect(polls).toBe(0);
    const login = await run(['login'], env);
    expect(login.code).toBe(0);
    expect(login.stdout).toContain(`${issuer}/activate`);
    expect(login.stdout).toContain('RPLS-1234');
    expect(login.stdout).not.toContain(deviceSecret);
    expect(login.stdout).not.toContain(accessSecret);
    expect(login.stdout).toContain('cli@example.test');
    expect(polls).toBeGreaterThanOrEqual(2);
    expect(requestedResource).toBe('https://viewer.example.test/workspace');

    const credentialFiles = await readdir(join(configDir, 'replays', 'credentials'));
    expect(credentialFiles).toHaveLength(1);
    const credentials = await readFile(join(configDir, 'replays', 'credentials', credentialFiles[0]!), 'utf8');
    expect(credentials).toContain(accessSecret);
    expect(await readFile(join(configDir, 'replays', 'config.json'), 'utf8')).not.toContain(accessSecret);
    expect((await stat(join(configDir, 'replays', 'credentials', credentialFiles[0]!))).mode & 0o777).toBe(0o600);
    const credentialPath = join(configDir, 'replays', 'credentials', credentialFiles[0]!);
    credentialPathForRefresh = credentialPath;

    const uploaded = await run(['upload', replayFile], env);
    expect(uploaded.code).toBe(0);
    expect(JSON.parse(uploaded.stdout)).toMatchObject({ success: true, id: 'device-upload' });
    expect(acceptedAuthorization).toBe(`Bearer ${issuedAccessToken}`);
    const explicitReplayPath = join(configDir, 'explicit-replay.json');
    await writeFile(explicitReplayPath, JSON.stringify(replay('device-upload-explicit')));
    const explicitSameTarget = await run(['upload', explicitReplayPath, '--upload-url', `${viewer.origin}/workspace/api/replays`], env);
    expect(explicitSameTarget.code).toBe(0);
    expect(acceptedAuthorization).toBe(`Bearer ${issuedAccessToken}`);
    const status = await run(['status'], env);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain('cli@example.test');
    expect(status.stdout).toContain('upload only');
    const expired = JSON.parse(await readFile(credentialPath, 'utf8')) as { expiresAt: number };
    expired.expiresAt = 1;
    await writeFile(credentialPath, JSON.stringify(expired));
    await chmod(credentialPath, 0o600);
    const refreshed = await run(['status'], env);
    expect(refreshed.code).toBe(0);
    expect(refreshes).toBe(1);
    expect(await readFile(credentialPath, 'utf8')).toContain(`${accessSecret}-rotated`);

    // Two independent CLI processes can both read the same expiring refresh token. The provider
    // rotates it for one process and rejects the other; the loser must reread and keep the winner.
    const expiredForRace = JSON.parse(await readFile(credentialPath, 'utf8')) as { expiresAt: number };
    expiredForRace.expiresAt = 1;
    await writeFile(credentialPath, JSON.stringify(expiredForRace));
    await chmod(credentialPath, 0o600);
    raceRefreshes = true;
    const concurrentStatuses = await Promise.all([run(['status'], env), run(['status'], env)]);
    expect(concurrentStatuses.map((result) => result.code)).toEqual([0, 0]);
    expect(concurrentRotationSaved).toBe(true);
    expect(refreshes).toBe(3);
    const concurrentCredential = JSON.parse(await readFile(credentialPath, 'utf8')) as { accessToken: string; refreshToken?: string };
    expect(concurrentCredential.refreshToken).toBe(activeRefreshToken);
    expect(concurrentCredential.refreshToken).toContain('-raced');

    // Hold an upload using the current access token, then rotate through a second CLI login before
    // returning 401 to the stale request. Its failure must not delete the newer login.
    const staleReplayPath = join(configDir, 'stale-upload.json');
    await writeFile(staleReplayPath, JSON.stringify(replay('stale-upload')));
    let markHeldUploadReached!: () => void;
    const heldUploadReached = new Promise<void>((done) => {
      markHeldUploadReached = done;
    });
    heldUploadReachedResolve = markHeldUploadReached;
    holdNextUploadFor401 = true;
    const staleUpload = run(['upload', staleReplayPath], env);
    await heldUploadReached;
    expect(heldUploadAuthorization).toBe(`Bearer ${concurrentCredential.accessToken}`);
    const expireConcurrentCredential = JSON.parse(await readFile(credentialPath, 'utf8')) as { expiresAt: number };
    expireConcurrentCredential.expiresAt = 1;
    await writeFile(credentialPath, JSON.stringify(expireConcurrentCredential));
    await chmod(credentialPath, 0o600);
    const newerLogin = await run(['login'], env);
    expect(newerLogin.code).toBe(0);
    const credentialAfterLogin = JSON.parse(await readFile(credentialPath, 'utf8')) as { accessToken: string; refreshToken?: string };
    expect(credentialAfterLogin.accessToken).not.toBe(concurrentCredential.accessToken);
    releaseHeldUpload?.();
    const staleUploadResult = await staleUpload;
    expect(staleUploadResult.code).toBe(3);
    expect(JSON.parse(await readFile(credentialPath, 'utf8'))).toMatchObject(credentialAfterLogin);
    expect((await run(['status'], env)).code).toBe(0);
    const afterRaceUploadPath = join(configDir, 'after-race-upload.json');
    await writeFile(afterRaceUploadPath, JSON.stringify(replay('after-race-upload')));
    const afterRaceUpload = await run(['upload', afterRaceUploadPath], env);
    expect(afterRaceUpload.code).toBe(0);
    expect(acceptedAuthorization).toBe(`Bearer ${credentialAfterLogin.accessToken}`);

    const restricted = await fetch(`${viewer.origin}/workspace/api/replays/device-upload`, {
      headers: { authorization: `Bearer ${token(issuer)}` },
    });
    expect(restricted.status).toBe(403);

    let leaked: string | undefined;
    const other = await listen((request, response) => {
      leaked = request.headers.authorization;
      response.writeHead(201, { 'content-type': 'application/json' }).end('{"id":"other-target"}');
    });
    const redirectAttempt = await run(['upload', replayFile, '--upload-url', `${other.origin}/api/replays`], env);
    expect(redirectAttempt.code).toBe(0);
    expect(leaked).toBeUndefined();
    const headerPath = join(configDir, 'headers.json');
    await writeFile(headerPath, JSON.stringify({ authorization: 'Bearer explicit-host-header' }), { mode: 0o600 });
    await run(['upload', replayFile, '--upload-url', `${other.origin}/api/replays`, '--header-file', headerPath], env);
    expect(leaked).toBe('Bearer explicit-host-header');

    const logout = await run(['logout'], env);
    expect(logout.code).toBe(0);
    expect(logout.stdout).toContain('provider revocation completed');
    expect(revocations.map((entry) => entry.get('token_type_hint'))).toEqual(['refresh_token', 'access_token']);
    expect(revocations[0]?.get('token')).toBe(credentialAfterLogin.refreshToken);
    expect(await readdir(join(configDir, 'replays', 'credentials'))).toEqual([]);
  }, 30_000);
});
