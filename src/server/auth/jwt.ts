import { createPublicKey, verify, type JsonWebKey, type KeyObject } from 'node:crypto';

export type JwtClaims = Record<string, unknown> & {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nbf?: number;
  nonce?: string;
};

export interface KeySource {
  /** The public key for `kid` (any key when the token names none and the set has exactly one). */
  key(kid: string | undefined): Promise<KeyObject | undefined>;
}

/** A JWKS endpoint with a small cache: refreshed hourly, and at most once a minute when an unknown `kid` shows up. */
export function jwksKeys(url: string, fetcher: typeof fetch = fetch, now: () => number = Date.now): KeySource {
  let cache: { at: number; keys: Map<string, KeyObject> } | undefined;
  return {
    async key(kid) {
      const age = now() - (cache?.at ?? -Infinity);
      const known = kid ? cache?.keys.has(kid) : (cache?.keys.size ?? 0) > 0;
      if (age > 60 * 60_000 || (!known && age > 60_000)) {
        try {
          const response = await fetcher(url, { signal: AbortSignal.timeout(5000) });
          if (!response.ok) throw new Error(`JWKS endpoint returned ${response.status}`);
          const { keys } = (await response.json()) as { keys: Array<JsonWebKey & { kid?: string; use?: string }> };
          cache = {
            at: now(),
            keys: new Map(
              keys
                .filter((jwk) => !jwk.use || jwk.use === 'sig')
                .map((jwk, index) => [jwk.kid ?? `#${index}`, createPublicKey({ key: jwk, format: 'jwk' })]),
            ),
          };
        } catch (error) {
          console.error('JWKS fetch failed:', error instanceof Error ? error.message : error);
        }
      }
      if (kid) return cache?.keys.get(kid);
      return cache?.keys.size === 1 ? [...cache.keys.values()][0] : undefined;
    },
  };
}

export interface VerifyOptions {
  keys: KeySource;
  issuer: string;
  /** The token's `aud` must contain one of these. */
  audience: string | readonly string[];
  /** Seconds since the epoch; tests pass a fixed value. */
  now?: number;
  nonce?: string;
  /** Leeway for clock skew, in seconds. */
  leeway?: number;
}

const ALGORITHMS: Record<string, { digest: string; dsaEncoding?: 'ieee-p1363' }> = {
  RS256: { digest: 'sha256' },
  ES256: { digest: 'sha256', dsaEncoding: 'ieee-p1363' },
};

/** Verifies signature (RS256 / ES256 only), issuer, audience, expiry and optionally nonce. Undefined on any failure. */
export async function verifyJwt(token: string, options: VerifyOptions): Promise<JwtClaims | undefined> {
  try {
    const [header = '', payload = '', signature = '', extra] = token.split('.');
    if (extra !== undefined || !signature) return undefined;
    const head = JSON.parse(Buffer.from(header, 'base64url').toString()) as { alg?: string; kid?: string };
    const algorithm = head.alg ? ALGORITHMS[head.alg] : undefined;
    if (!algorithm) return undefined;
    const key = await options.keys.key(head.kid);
    if (!key) return undefined;
    const signed = verify(
      algorithm.digest,
      Buffer.from(`${header}.${payload}`),
      algorithm.dsaEncoding ? { key, dsaEncoding: algorithm.dsaEncoding } : key,
      Buffer.from(signature, 'base64url'),
    );
    if (!signed) return undefined;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as JwtClaims;
    const now = options.now ?? Date.now() / 1000;
    const leeway = options.leeway ?? 30;
    if (claims.iss !== options.issuer) return undefined;
    const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
    const wanted = typeof options.audience === 'string' ? [options.audience] : options.audience;
    if (!audiences.some((aud) => wanted.includes(aud))) return undefined;
    if (typeof claims.exp !== 'number' || claims.exp <= now - leeway) return undefined;
    if (typeof claims.nbf === 'number' && claims.nbf > now + leeway) return undefined;
    if (typeof claims.iat === 'number' && claims.iat > now + leeway) return undefined;
    if (options.nonce !== undefined && claims.nonce !== options.nonce) return undefined;
    return claims;
  } catch {
    return undefined;
  }
}
