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
  /** Accepted `alg` values; default both supported ones. */
  algorithms?: readonly JwtAlgorithm[];
  /** Refuse a token without a numeric `iat`. */
  requireIat?: boolean;
}

/** The signature algorithms the verifier supports. */
export type JwtAlgorithm = 'RS256' | 'ES256';

const ALGORITHMS: Record<JwtAlgorithm, { digest: string; dsaEncoding?: 'ieee-p1363' }> = {
  RS256: { digest: 'sha256' },
  ES256: { digest: 'sha256', dsaEncoding: 'ieee-p1363' },
};
const ALL_ALGORITHMS = Object.keys(ALGORITHMS) as JwtAlgorithm[];

/** Verifies signature (RS256 / ES256 only), issuer, audience, expiry and optionally nonce. Undefined on any failure. */
export async function verifyJwtWith(token: string, options: VerifyOptions): Promise<JwtClaims | undefined> {
  try {
    const [header = '', payload = '', signature = '', extra] = token.split('.');
    if (extra !== undefined || !signature) return undefined;
    const head = JSON.parse(Buffer.from(header, 'base64url').toString()) as { alg?: string; kid?: string };
    const allowed: readonly string[] = options.algorithms ?? ALL_ALGORITHMS;
    const algorithm = head.alg && allowed.includes(head.alg) ? ALGORITHMS[head.alg as JwtAlgorithm] : undefined;
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
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return undefined;
    const now = options.now ?? Date.now() / 1000;
    const leeway = options.leeway ?? 30;
    if (claims.iss !== options.issuer) return undefined;
    const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
    const wanted = typeof options.audience === 'string' ? [options.audience] : options.audience;
    if (!audiences.some((aud) => wanted.includes(aud))) return undefined;
    if (typeof claims.exp !== 'number' || claims.exp <= now - leeway) return undefined;
    if (typeof claims.nbf === 'number' && claims.nbf > now + leeway) return undefined;
    if (options.requireIat && typeof claims.iat !== 'number') return undefined;
    if (typeof claims.iat === 'number' && claims.iat > now + leeway) return undefined;
    if (options.nonce !== undefined && claims.nonce !== options.nonce) return undefined;
    return claims;
  } catch {
    return undefined;
  }
}

/** A JSON Web Key Set, as a JWKS endpoint serves it. */
export interface JsonWebKeySet {
  keys: ReadonlyArray<JsonWebKey & { kid?: string; use?: string }>;
}

export interface VerifyJwtOptions {
  /** The compact JWT (`header.payload.signature`). */
  token: string;
  /** A JWKS endpoint, cached per URL: refreshed hourly, and at most once a minute when an unknown `kid` shows up. */
  jwksUrl?: string;
  /** Or the key set itself. Exactly one of `jwksUrl` and `jwks`. */
  jwks?: JsonWebKeySet;
  /** The exact `iss`. */
  issuer: string;
  /** The token's `aud` must be, or contain, one of these. */
  audience: string | readonly string[];
  /** Accepted `alg` values. Default both supported ones, `RS256` and `ES256`. */
  algorithms?: readonly JwtAlgorithm[];
  /** Clock-skew leeway for `exp`, `nbf` and `iat`, in seconds. Default 30. */
  leewaySec?: number;
  /** Refuse a token without `iat`. Default false. */
  requireIat?: boolean;
  /** Seconds since the epoch; default now. For tests. */
  now?: number;
  /** The `fetch` used for `jwksUrl` (tests, an egress proxy). Each distinct function has its own key cache. */
  fetch?: typeof fetch;
}

const urlKeys = new WeakMap<typeof fetch, Map<string, KeySource>>();

function staticKeys(set: JsonWebKeySet): KeySource {
  const keys = new Map(
    set.keys
      .filter((jwk) => !jwk.use || jwk.use === 'sig')
      .map((jwk, index) => [jwk.kid ?? `#${index}`, createPublicKey({ key: jwk, format: 'jwk' })] as const),
  );
  return {
    async key(kid) {
      if (kid) return keys.get(kid);
      return keys.size === 1 ? [...keys.values()][0] : undefined;
    },
  };
}

/**
 * Verifies a JWT: the signature against a JWKS (`RS256` or `ES256`), the exact issuer, the audience, `exp` (required),
 * `nbf` and `iat` with leeway, and `iat` presence when asked. Resolves to the claims, or undefined when anything is
 * wrong; a bad token never throws (a bad call, such as both or neither of `jwksUrl` and `jwks`, does). The building
 * block of a proxy auth adapter:
 *
 *   const claims = await verifyJwt({ token, jwksUrl: 'https://proxy.example.com/jwks', issuer, audience, algorithms: ['ES256'] });
 */
export async function verifyJwt(options: VerifyJwtOptions): Promise<JwtClaims | undefined> {
  if (!options.jwksUrl === !options.jwks) throw new Error('verifyJwt needs exactly one of jwksUrl and jwks');
  if (typeof options.token !== 'string' || !options.token) return undefined;
  let keys: KeySource;
  if (options.jwks) keys = staticKeys(options.jwks);
  else {
    const url = options.jwksUrl!;
    const fetcher = options.fetch ?? fetch;
    let byUrl = urlKeys.get(fetcher);
    if (!byUrl) urlKeys.set(fetcher, (byUrl = new Map()));
    keys = byUrl.get(url) ?? jwksKeys(url, fetcher, () => Date.now());
    byUrl.set(url, keys);
  }
  return verifyJwtWith(options.token, {
    keys,
    issuer: options.issuer,
    audience: options.audience,
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.leewaySec !== undefined ? { leeway: options.leewaySec } : {}),
    ...(options.algorithms ? { algorithms: options.algorithms } : {}),
    ...(options.requireIat ? { requireIat: true } : {}),
  });
}
