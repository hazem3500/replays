import { createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app.ts';
import { authFromEnv } from '../src/server/auth/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import { appDefaults } from './fixtures.ts';

const b64 = (value: Buffer | string) => Buffer.from(value).toString('base64url');

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function listen(handler: Parameters<typeof createServer>[1]) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const request = (headers: Record<string, string> = {}) =>
  ({ headers, socket: { remoteAddress: '10.0.0.5' } }) as unknown as IncomingMessage;

async function pluginFile(source: string, name = 'plugin.mjs') {
  const dir = await mkdtemp(join(tmpdir(), 'replays-plugin-'));
  const file = join(dir, name);
  await writeFile(file, source);
  return file;
}

describe('AUTH_MODE=plugin', () => {
  it('loads a module by absolute path and calls its default export with the environment', async () => {
    const file = await pluginFile(`
      export default (env) => ({
        name: 'throwaway',
        authenticate(request) {
          const who = request.headers['x-who'];
          return typeof who === 'string' ? { id: who + env.PLUGIN_SUFFIX } : undefined;
        },
      });
    `);
    const auth = await authFromEnv({ AUTH_MODE: 'plugin', AUTH_PLUGIN: file, PLUGIN_SUFFIX: '@example.com' });
    expect(auth.name).toBe('throwaway');
    expect(await auth.authenticate(request({ 'x-who': 'ada' }))).toEqual({ id: 'ada@example.com' });
    expect(await auth.authenticate(request())).toBeUndefined();
  });

  it('resolves a relative path against the working directory and accepts an async factory', async () => {
    const file = await pluginFile(`export default async () => ({ name: 'relative', authenticate: () => ({ id: 'relative-user' }) });`);
    const auth = await authFromEnv({ AUTH_MODE: 'plugin', AUTH_PLUGIN: `./${relative(process.cwd(), file)}` });
    expect(auth.name).toBe('relative');
    expect(await auth.authenticate(request())).toEqual({ id: 'relative-user' });
  });

  it('accepts a file URL specifier', async () => {
    const file = await pluginFile(`export default () => ({ name: 'by-url', authenticate: () => undefined });`);
    // Not a path (no leading . or /): handed to import() as it is.
    const auth = await authFromEnv({ AUTH_MODE: 'plugin', AUTH_PLUGIN: pathToFileURL(file).href });
    expect(auth.name).toBe('by-url');
  });

  it('rejects a plugin that is missing, has no default function, or returns no adapter', async () => {
    await expect(authFromEnv({ AUTH_MODE: 'plugin' })).rejects.toThrow(/AUTH_MODE=plugin needs AUTH_PLUGIN/);
    await expect(authFromEnv({ AUTH_MODE: 'plugin', AUTH_PLUGIN: join(tmpdir(), 'does-not-exist-plugin.mjs') })).rejects.toThrow(
      /Cannot find module/,
    );

    const notFunction = await pluginFile(`export default { name: 'object' };`);
    await expect(authFromEnv({ AUTH_MODE: 'plugin', AUTH_PLUGIN: notFunction })).rejects.toThrow(/must default-export a function/);

    const noDefault = await pluginFile(`export const factory = () => ({});`);
    await expect(authFromEnv({ AUTH_MODE: 'plugin', AUTH_PLUGIN: noDefault })).rejects.toThrow(/must default-export a function/);

    const nothing = await pluginFile(`export default () => undefined;`);
    await expect(authFromEnv({ AUTH_MODE: 'plugin', AUTH_PLUGIN: nothing })).rejects.toThrow(/did not return an AuthAdapter/);

    const noAuthenticate = await pluginFile(`export default () => ({ name: 'broken' });`);
    await expect(authFromEnv({ AUTH_MODE: 'plugin', AUTH_PLUGIN: noAuthenticate })).rejects.toThrow(/did not return an AuthAdapter/);
  });

  it('lets a plugin own routes and a login page behind createApp', async () => {
    const file = await pluginFile(`
      export default () => ({
        name: 'portal',
        routes: ['/auth/portal'],
        authenticate(request) {
          return /(^|; )portal=ada/.test(request.headers.cookie ?? '') ? { id: 'ada@example.com', name: 'Ada Example' } : undefined;
        },
        loginUrl: (request, context) => context.base + '/auth/portal',
        handle(request, response) {
          response.writeHead(204, { 'set-cookie': 'portal=ada; Path=/' });
          response.end();
          return true;
        },
      });
    `);
    const auth = await authFromEnv({ AUTH_MODE: 'plugin', AUTH_PLUGIN: file });
    const root = await mkdtemp(join(tmpdir(), 'replays-plugin-app-'));
    const handle = createApp({
      ...appDefaults(),
      auth,
      store: new ReplayStore(join(root, 'data'), join(root, 'sample')),
      clientDir: join(root, 'client'),
    });
    const origin = await listen((req, res) => void handle(req, res));
    expect((await fetch(`${origin}/api/me`)).status).toBe(401);
    const page = await fetch(`${origin}/r/abc`, { redirect: 'manual', headers: { accept: 'text/html' } });
    expect([page.status, page.headers.get('location')]).toEqual([302, '/auth/portal']);
    const signedIn = await fetch(`${origin}/auth/portal`);
    expect(signedIn.status).toBe(204);
    const me = await fetch(`${origin}/api/me`, { headers: { cookie: 'portal=ada' } });
    expect(await me.json()).toEqual({ id: 'ada@example.com', name: 'Ada Example', session: { signedIn: true } });
    expect((await (await fetch(`${origin}/api/config`, { headers: { cookie: 'portal=ada' } })).json()).auth).toBe('portal');
  });
});

describe('example plugin: signed header', () => {
  const PLUGIN = new URL('../examples/auth-signed-header/plugin.mjs', import.meta.url);
  const ISSUER = 'https://idp.example.test';
  const AUDIENCE = 'replays';
  const NOW = 1_800_000_000;

  let rsa: { privateKey: KeyObject; jwk: Record<string, unknown> };
  let ec: { privateKey: KeyObject; jwk: Record<string, unknown> };
  let plugin: {
    default: (
      env: Record<string, string>,
      options?: Record<string, unknown>,
    ) => { name: string; authenticate(request: IncomingMessage): Promise<unknown> };
    verifySignedHeader: (token: string, options: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>;
  };

  beforeAll(async () => {
    const rsaPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    rsa = { privateKey: rsaPair.privateKey, jwk: { ...rsaPair.publicKey.export({ format: 'jwk' }), kid: 'rsa-1', alg: 'RS256' } };
    const ecPair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    ec = { privateKey: ecPair.privateKey, jwk: { ...ecPair.publicKey.export({ format: 'jwk' }), kid: 'ec-1', alg: 'ES256' } };
    plugin = (await import(PLUGIN.href)) as typeof plugin;
  });

  const token = (claims: Record<string, unknown>, which: 'rsa' | 'ec' = 'rsa', kid?: string) => {
    const key = which === 'rsa' ? rsa : ec;
    const header = b64(JSON.stringify({ alg: which === 'rsa' ? 'RS256' : 'ES256', kid: kid ?? key.jwk.kid }));
    const payload = b64(JSON.stringify(claims));
    const options = which === 'ec' ? { key: key.privateKey, dsaEncoding: 'ieee-p1363' as const } : key.privateKey;
    return `${header}.${payload}.${b64(sign('sha256', Buffer.from(`${header}.${payload}`), options))}`;
  };
  const claims = (extra: Record<string, unknown> = {}) => ({
    iss: ISSUER,
    aud: AUDIENCE,
    iat: NOW - 10,
    exp: NOW + 300,
    email: 'Ada@Example.com',
    name: 'Ada Example',
    ...extra,
  });
  const keyFor = async (kid: string) =>
    kid === 'rsa-1'
      ? createPublicKey({ key: rsa.jwk as never, format: 'jwk' })
      : kid === 'ec-1'
        ? createPublicKey({ key: ec.jwk as never, format: 'jwk' })
        : undefined;
  const env = (extra: Record<string, string> = {}) => ({
    SIGNED_HEADER_ISSUER: ISSUER,
    SIGNED_HEADER_AUDIENCE: AUDIENCE,
    SIGNED_HEADER_JWKS_URL: 'https://idp.example.test/jwks.json',
    ...extra,
  });
  const build = (extra: Record<string, string> = {}) => plugin.default(env(extra), { keyFor, now: NOW });

  it('loads through AUTH_MODE=plugin from the examples directory', async () => {
    const auth = await authFromEnv({ ...env(), AUTH_MODE: 'plugin', AUTH_PLUGIN: './examples/auth-signed-header/plugin.mjs' });
    expect(auth.name).toBe('signed-header');
  });

  it('names a missing setting', () => {
    for (const name of ['SIGNED_HEADER_ISSUER', 'SIGNED_HEADER_AUDIENCE', 'SIGNED_HEADER_JWKS_URL'])
      expect(() => plugin.default({ ...env(), [name]: '' }, { now: NOW })).toThrow(new RegExp(name));
  });

  it('accepts an RS256 or ES256 token from the header and lower-cases the email', async () => {
    const auth = build();
    for (const which of ['rsa', 'ec'] as const) {
      const identity = await auth.authenticate(request({ 'x-signed-identity': token(claims(), which) }));
      expect(identity).toEqual({ id: 'ada@example.com', email: 'ada@example.com', name: 'Ada Example' });
    }
  });

  it('reads the header and the email claim named in the environment', async () => {
    const auth = build({ SIGNED_HEADER_NAME: 'X-Proxy-Identity', SIGNED_HEADER_EMAIL_CLAIM: 'mail' });
    const signed = token(claims({ email: undefined, mail: 'grace@example.com' }));
    expect(await auth.authenticate(request({ 'x-proxy-identity': signed }))).toMatchObject({ id: 'grace@example.com' });
    expect(await auth.authenticate(request({ 'x-signed-identity': signed }))).toBeUndefined();
  });

  it('rejects a missing header, a wrong issuer or audience, an expired token and a token without an email', async () => {
    const auth = build();
    const who = (extra: Record<string, unknown>) => auth.authenticate(request({ 'x-signed-identity': token(claims(extra)) }));
    expect(await auth.authenticate(request())).toBeUndefined();
    expect(await who({ iss: 'https://evil.example.test' })).toBeUndefined();
    expect(await who({ aud: 'another-app' })).toBeUndefined();
    expect(await who({ exp: NOW - 3600 })).toBeUndefined();
    expect(await who({ iat: NOW + 3600 })).toBeUndefined();
    expect(await who({ email: undefined })).toBeUndefined();
    expect(await who({ aud: ['other', AUDIENCE] })).toBeDefined();
  });

  it('rejects a bad signature, an unknown key id, alg none and junk', async () => {
    const auth = build();
    const good = token(claims());
    const [head, , signature] = good.split('.');
    const forged = `${head}.${b64(JSON.stringify(claims({ email: 'admin@example.com' })))}.${signature}`;
    const none = `${b64(JSON.stringify({ alg: 'none', kid: 'rsa-1' }))}.${b64(JSON.stringify(claims()))}.`;
    for (const bad of [forged, token(claims(), 'rsa', 'unknown-kid'), none, 'junk', `${good}.extra`, good.split('.').slice(0, 2).join('.')])
      expect(await auth.authenticate(request({ 'x-signed-identity': bad }))).toBeUndefined();
    // A token signed with the EC key but labelled with the RSA key id does not verify.
    expect(await auth.authenticate(request({ 'x-signed-identity': token(claims(), 'ec', 'rsa-1') }))).toBeUndefined();
  });

  it('applies the allow list: domains and exact emails', async () => {
    const auth = build({ SIGNED_HEADER_ALLOW: '@team.example.org, ada@example.com' });
    const who = (email: string) => auth.authenticate(request({ 'x-signed-identity': token(claims({ email })) }));
    expect(await who('ada@example.com')).toBeDefined();
    expect(await who('grace@team.example.org')).toBeDefined();
    expect(await who('eve@example.com')).toBeUndefined();
    expect(await who('eve@team.example.org.evil.test')).toBeUndefined();
  });

  it('fetches the proxy keys from the JWKS URL', async () => {
    let hits = 0;
    const origin = await listen((_req, res) => {
      hits++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [rsa.jwk, ec.jwk] }));
    });
    const auth = plugin.default(env({ SIGNED_HEADER_JWKS_URL: `${origin}/jwks.json` }), { now: NOW });
    expect(await auth.authenticate(request({ 'x-signed-identity': token(claims(), 'ec') }))).toMatchObject({ id: 'ada@example.com' });
    expect(await auth.authenticate(request({ 'x-signed-identity': token(claims(), 'rsa') }))).toMatchObject({ id: 'ada@example.com' });
    // Keys are cached between requests.
    expect(hits).toBe(1);
  });

  it('refuses everything when the JWKS endpoint is down', async () => {
    const origin = await listen((_req, res) => {
      res.writeHead(500);
      res.end();
    });
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      const auth = plugin.default(env({ SIGNED_HEADER_JWKS_URL: `${origin}/jwks.json` }), { now: NOW });
      expect(await auth.authenticate(request({ 'x-signed-identity': token(claims()) }))).toBeUndefined();
    } finally {
      console.error = original;
    }
    expect(String(errors[0]?.[1])).toMatch(/JWKS endpoint returned 500/);
  });
});
