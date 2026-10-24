import { generateKeyPairSync, type JsonWebKey, type KeyObject, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyJwt } from '../src/server/index.ts';

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = {
  keys: [
    { ...(ec.publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: 'ec-1' },
    { ...(rsa.publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: 'rsa-1' },
  ],
};

const NOW = 1_800_000_000;
const ISSUER = 'https://proxy.example.com';

function token(claims: Record<string, unknown>, options: { alg?: 'ES256' | 'RS256'; kid?: string; key?: KeyObject } = {}) {
  const alg = options.alg ?? 'ES256';
  const header = b64({ alg, kid: options.kid ?? (alg === 'ES256' ? 'ec-1' : 'rsa-1'), typ: 'JWT' });
  const payload = b64(claims);
  const key = options.key ?? (alg === 'ES256' ? ec.privateKey : rsa.privateKey);
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key);
  return `${header}.${payload}.${signature.toString('base64url')}`;
}

const good = { iss: ISSUER, aud: 'replays', exp: NOW + 600, iat: NOW - 10, email: 'ada@example.com' };
const check = (t: string, extra: Partial<Parameters<typeof verifyJwt>[0]> = {}) =>
  verifyJwt({ token: t, jwks, issuer: ISSUER, audience: 'replays', now: NOW, ...extra });

describe('verifyJwt', () => {
  it('returns the claims of a good ES256 or RS256 token', async () => {
    await expect(check(token(good))).resolves.toMatchObject({ email: 'ada@example.com' });
    await expect(check(token(good, { alg: 'RS256' }))).resolves.toMatchObject({ email: 'ada@example.com' });
    await expect(check(token({ ...good, aud: ['other', 'replays'] }))).resolves.toBeTruthy();
  });

  it('refuses the wrong issuer, audience, key, or a tampered token', async () => {
    await expect(check(token({ ...good, iss: 'https://evil.test' }))).resolves.toBeUndefined();
    await expect(check(token({ ...good, aud: 'other' }))).resolves.toBeUndefined();
    await expect(check(token(good, { key: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey }))).resolves.toBeUndefined();
    await expect(check(token(good, { kid: 'unknown' }))).resolves.toBeUndefined();
    const [header, , signature] = token(good).split('.');
    await expect(check(`${header}.${b64({ ...good, email: 'eve@example.com' })}.${signature}`)).resolves.toBeUndefined();
    await expect(check('not.a.jwt')).resolves.toBeUndefined();
    await expect(check('')).resolves.toBeUndefined();
  });

  it('applies algorithms, expiry with leeway, and requireIat', async () => {
    await expect(check(token(good, { alg: 'RS256' }), { algorithms: ['ES256'] })).resolves.toBeUndefined();
    await expect(check(token({ ...good, exp: NOW - 20 }))).resolves.toBeTruthy();
    await expect(check(token({ ...good, exp: NOW - 20 }), { leewaySec: 10 })).resolves.toBeUndefined();
    await expect(check(token({ ...good, exp: undefined }))).resolves.toBeUndefined();
    await expect(check(token({ ...good, iat: undefined }))).resolves.toBeTruthy();
    await expect(check(token({ ...good, iat: undefined }), { requireIat: true })).resolves.toBeUndefined();
    await expect(check(token({ ...good, iat: NOW + 120 }))).resolves.toBeUndefined();
    await expect(check(token({ ...good, nbf: NOW + 120 }))).resolves.toBeUndefined();
  });

  it('fetches a jwksUrl once and caches it per URL, refetching an unknown kid at most once a minute', async () => {
    const calls: string[] = [];
    const fetcher = (async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify(jwks), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const viaUrl = (t: string) =>
      verifyJwt({ token: t, jwksUrl: 'https://keys.example.com/jwks', fetch: fetcher, issuer: ISSUER, audience: 'replays', now: NOW });
    await expect(viaUrl(token(good))).resolves.toBeTruthy();
    await expect(viaUrl(token(good, { alg: 'RS256' }))).resolves.toBeTruthy();
    await expect(viaUrl(token(good, { kid: 'rotated' }))).resolves.toBeUndefined();
    expect(calls).toEqual(['https://keys.example.com/jwks']);
  });

  it('needs exactly one of jwksUrl and jwks', async () => {
    await expect(verifyJwt({ token: token(good), issuer: ISSUER, audience: 'replays' })).rejects.toThrow(/exactly one of jwksUrl and jwks/);
    await expect(
      verifyJwt({ token: token(good), jwks, jwksUrl: 'https://keys.example.com/jwks', issuer: ISSUER, audience: 'replays' }),
    ).rejects.toThrow(/exactly one/);
  });
});
