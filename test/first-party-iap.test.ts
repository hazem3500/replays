import { generateKeyPairSync, type JsonWebKey, type KeyObject, sign } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import iap, { IAP_ISSUER, IAP_JWKS_URL, iapAuth, type IapOptions } from '../src/first-party/iap.ts';
import { PluginError, resolvePlugins } from '../src/plugin/index.ts';
import { startServer, type RunningServer } from '../src/server/start.ts';
import { describeAuthAdapter, fakeRequest } from '../src/server/testing/index.ts';

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const google = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const rotated = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = (key: KeyObject, kid: string) => ({ ...(key.export({ format: 'jwk' }) as JsonWebKey), kid, alg: 'ES256' });

const AUDIENCE = '/projects/123/global/backendServices/456';
const NOW = 1_800_000_000;

function assertion(claims: Record<string, unknown>, options: { kid?: string; key?: KeyObject } = {}) {
  const header = b64({ alg: 'ES256', kid: options.kid ?? 'k1', typ: 'JWT' });
  const payload = b64(claims);
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: options.key ?? google.privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${header}.${payload}.${signature.toString('base64url')}`;
}

const claims = (extra: Record<string, unknown> = {}) => ({
  iss: IAP_ISSUER,
  aud: AUDIENCE,
  iat: NOW - 5,
  exp: NOW + 600,
  sub: 'accounts.google.com:1',
  email: 'ada@example.com',
  ...extra,
});

/** Google's key endpoint, in memory; counts fetches. */
function keyServer(keys = [jwk(google.publicKey, 'k1')]) {
  const served = { keys, calls: 0 };
  const fetcher = (async (url: string | URL) => {
    expect(String(url)).toBe(IAP_JWKS_URL);
    served.calls++;
    return new Response(JSON.stringify({ keys: served.keys }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { served, fetcher };
}

const options = (fetcher: typeof fetch, extra: Partial<IapOptions> = {}): IapOptions => ({
  audience: AUDIENCE,
  domains: ['example.com'],
  serviceAccounts: ['runner@acme-ci.iam.gserviceaccount.com'],
  fetch: fetcher,
  now: () => NOW,
  ...extra,
});

const withHeader = (token: string) => fakeRequest({ headers: { 'x-goog-iap-jwt-assertion': token } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('iap auth', () => {
  it('accepts a person in an allowed domain, with their email as the id', async () => {
    const { fetcher } = keyServer();
    const auth = iapAuth(options(fetcher), {});
    await expect(auth.authenticate(withHeader(assertion(claims({ email: 'Ada@Example.com' }))))).resolves.toEqual({
      id: 'ada@example.com',
      email: 'ada@example.com',
    });
  });

  it('refuses the wrong audience, issuer, domain, expired tokens and tokens without iat', async () => {
    const { fetcher } = keyServer();
    const auth = iapAuth(options(fetcher), {});
    const refused = async (token: string) => expect(await auth.authenticate(withHeader(token))).toBeUndefined();
    await refused(assertion(claims({ aud: '/projects/123/global/backendServices/999' })));
    await refused(assertion(claims({ aud: [AUDIENCE, 'other'] })));
    await refused(assertion(claims({ iss: 'https://accounts.google.com' })));
    await refused(assertion(claims({ email: 'eve@evil.test' })));
    await refused(assertion(claims({ email: 'eve@sub.example.com' })));
    await refused(assertion(claims({ email: 'eve@example.com.evil.test' })));
    await refused(assertion(claims({ exp: NOW - 31 })));
    await refused(assertion(claims({ iat: undefined })));
    await refused(assertion(claims({ iat: NOW + 120 })));
    await refused(assertion(claims(), { key: rotated.privateKey }));
    await refused('garbage');
    // Inside the 30 s leeway is still fine.
    expect(await auth.authenticate(withHeader(assertion(claims({ exp: NOW - 20 }))))).toBeTruthy();
  });

  it('lets in exactly the listed service accounts', async () => {
    const { fetcher } = keyServer();
    const auth = iapAuth(options(fetcher), {});
    await expect(auth.authenticate(withHeader(assertion(claims({ email: 'runner@acme-ci.iam.gserviceaccount.com' }))))).resolves.toEqual({
      id: 'runner@acme-ci.iam.gserviceaccount.com',
      email: 'runner@acme-ci.iam.gserviceaccount.com',
    });
    await expect(
      auth.authenticate(withHeader(assertion(claims({ email: 'other@acme-ci.iam.gserviceaccount.com' })))),
    ).resolves.toBeUndefined();
  });

  it('caches Google keys and refetches for an unknown kid at most once a minute', async () => {
    const { served, fetcher } = keyServer();
    const auth = iapAuth(options(fetcher), {});
    for (let index = 0; index < 3; index++) expect(await auth.authenticate(withHeader(assertion(claims())))).toBeTruthy();
    expect(served.calls).toBe(1);
    // A rotated key the cache has not seen: one refetch, then no more within the minute.
    served.keys = [jwk(google.publicKey, 'k1'), jwk(rotated.publicKey, 'k2')];
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    expect(await auth.authenticate(withHeader(assertion(claims(), { kid: 'k2', key: rotated.privateKey })))).toBeTruthy();
    expect(served.calls).toBe(2);
    expect(await auth.authenticate(withHeader(assertion(claims(), { kid: 'k3', key: rotated.privateKey })))).toBeUndefined();
    expect(served.calls).toBe(2);
  });

  it('reads its options from the environment, and refuses a non-service-account entry at start', async () => {
    const { fetcher } = keyServer();
    const auth = iapAuth(
      { fetch: fetcher, now: () => NOW },
      {
        IAP_JWT_AUDIENCE: AUDIENCE,
        IAP_ALLOWED_DOMAINS: 'example.org, example.com',
        IAP_SERVICE_ACCOUNTS: 'runner@acme-ci.iam.gserviceaccount.com',
      },
    );
    expect(await auth.authenticate(withHeader(assertion(claims())))).toMatchObject({ id: 'ada@example.com' });
    expect(() => iapAuth({ domains: ['example.com'] }, {})).toThrow(/audience/);
    expect(() => iapAuth({ audience: AUDIENCE }, {})).toThrow(/domains or serviceAccounts/);
    expect(() => iapAuth({ audience: AUDIENCE, serviceAccounts: ['someone@example.com'] }, {})).toThrow(
      /only list \*\.gserviceaccount\.com addresses; refusing "someone@example.com"/,
    );
    const error = await resolvePlugins([iap({ audience: AUDIENCE, domains: ['example.com'] })], {
      env: { IAP_SERVICE_ACCOUNTS: 'person@gmail.com' },
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(PluginError);
    expect(error).toMatchObject({ code: 'setup-failed', plugin: 'iap' });
  });

  it('signs in requests without the header as devFallback, and still verifies those that have one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fetcher } = keyServer();
    const auth = iapAuth(options(fetcher, { devFallback: 'dev@example.com' }), {});
    await expect(auth.authenticate(fakeRequest())).resolves.toEqual({ id: 'dev@example.com', email: 'dev@example.com' });
    await expect(auth.authenticate(withHeader('forged'))).resolves.toBeUndefined();
  });
});

describeAuthAdapter(
  'iap',
  {
    create: () => iapAuth(options(keyServer().fetcher), {}),
    accepts: [
      {
        title: 'a valid IAP assertion',
        request: () => ({ headers: { 'x-goog-iap-jwt-assertion': assertion(claims()) } }),
        id: 'ada@example.com',
      },
    ],
    refuses: [
      { title: 'no header', request: {} },
      { title: 'a token without iat', request: () => ({ headers: { 'x-goog-iap-jwt-assertion': assertion(claims({ iat: undefined })) } }) },
    ],
  },
  { describe, it },
);

describe('iap plugin in a server', () => {
  let server: RunningServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('answers 403 without the header and serves an allowed person', async () => {
    const { fetcher } = keyServer();
    const dir = await mkdtemp(join(tmpdir(), 'replays-iap-'));
    server = await startServer({
      port: 0,
      log: () => {},
      config: { dir, file: {}, plugins: [iap({ ...options(fetcher), now: () => Date.now() / 1000 })] },
      sampleDir: dir,
      env: { DATA_DIR: join(dir, 'data'), POSTERS_DISABLED: '1', RENDER_DISABLED: '1' },
    });
    expect((await fetch(`${server.origin}/api/me`)).status).toBe(403);
    const now = Math.floor(Date.now() / 1000);
    const response = await fetch(`${server.origin}/api/me`, {
      headers: { 'x-goog-iap-jwt-assertion': assertion(claims({ iat: now - 5, exp: now + 600 })) },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 'ada@example.com' });
    const headers = { 'x-goog-iap-jwt-assertion': assertion(claims({ iat: now - 5, exp: now + 600 })) };
    expect(await (await fetch(`${server.origin}/api/config`, { headers })).json()).toMatchObject({
      plugins: expect.arrayContaining(['iap']),
    });
  });
});
