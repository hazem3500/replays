// Example auth plugin: trust a signed identity header added by an identity-aware proxy or API gateway.
//
// Proxies of this kind authenticate the user, then forward a short-lived JWT in a request header (and publish
// the public keys at a JWKS URL). Unlike the plain `header` adapter, nothing here depends on network position:
// the signature, issuer, audience and expiry of every request's token are verified.
//
//   AUTH_MODE=plugin
//   AUTH_PLUGIN=/app/examples/auth-signed-header/plugin.mjs
//   SIGNED_HEADER_NAME=x-signed-identity            # header carrying the JWT
//   SIGNED_HEADER_JWKS_URL=https://idp.example.com/.well-known/jwks.json
//   SIGNED_HEADER_ISSUER=https://idp.example.com
//   SIGNED_HEADER_AUDIENCE=replay-kit               # the audience the proxy mints tokens for
//   SIGNED_HEADER_ALLOW=@example.com,ada@example.org  # optional: email domains (@…) or exact emails
//   SIGNED_HEADER_EMAIL_CLAIM=email                 # optional, default "email"
//
// It is self-contained on purpose (node:crypto + fetch only), so you can copy this file next to your deployment.
// Supported algorithms: ES256 and RS256.
import { createPublicKey, verify } from 'node:crypto';

const ALGORITHMS = {
  ES256: { digest: 'sha256', dsaEncoding: 'ieee-p1363' },
  RS256: { digest: 'sha256' },
};

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`the signed-header plugin needs ${name}`);
  return value;
}

function jwksCache(url, fetcher = fetch) {
  let cache;
  return async (kid) => {
    const age = Date.now() - (cache?.at ?? 0);
    if (age > 3_600_000 || (!cache?.keys.has(kid) && age > 60_000)) {
      try {
        const response = await fetcher(url, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error(`JWKS endpoint returned ${response.status}`);
        const { keys } = await response.json();
        cache = { at: Date.now(), keys: new Map(keys.map((jwk) => [jwk.kid, createPublicKey({ key: jwk, format: 'jwk' })])) };
      } catch (error) {
        console.error('signed-header: JWKS fetch failed:', error instanceof Error ? error.message : error);
      }
    }
    return cache?.keys.get(kid);
  };
}

/** Verifies the token and returns its claims, or undefined. Exported for tests. */
export async function verifySignedHeader(token, { keyFor, issuer, audience, now = Date.now() / 1000 }) {
  try {
    const [header, payload, signature, extra] = token.split('.');
    if (!signature || extra !== undefined) return undefined;
    const head = JSON.parse(Buffer.from(header, 'base64url').toString());
    const algorithm = ALGORITHMS[head.alg];
    const key = algorithm && head.kid ? await keyFor(head.kid) : undefined;
    if (!algorithm || !key) return undefined;
    const ok = verify(
      algorithm.digest,
      Buffer.from(`${header}.${payload}`),
      algorithm.dsaEncoding ? { key, dsaEncoding: algorithm.dsaEncoding } : key,
      Buffer.from(signature, 'base64url'),
    );
    if (!ok) return undefined;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const fresh = typeof claims.exp === 'number' && claims.exp > now - 30 && (claims.iat === undefined || claims.iat < now + 30);
    if (claims.iss !== issuer || !audiences.includes(audience) || !fresh) return undefined;
    return claims;
  } catch {
    return undefined;
  }
}

/** The AuthPluginFactory: `(env) => AuthAdapter` (see src/server/auth/types.ts). */
export default function signedHeaderAuth(env = process.env, options = {}) {
  const header = (env.SIGNED_HEADER_NAME?.trim() || 'x-signed-identity').toLowerCase();
  const issuer = required(env, 'SIGNED_HEADER_ISSUER');
  const audience = required(env, 'SIGNED_HEADER_AUDIENCE');
  const keyFor = options.keyFor ?? jwksCache(required(env, 'SIGNED_HEADER_JWKS_URL'), options.fetcher);
  const emailClaim = env.SIGNED_HEADER_EMAIL_CLAIM?.trim() || 'email';
  const allow = (env.SIGNED_HEADER_ALLOW ?? '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return {
    name: 'signed-header',
    async authenticate(request) {
      const token = request.headers[header];
      if (typeof token !== 'string') return undefined;
      const claims = await verifySignedHeader(token, { keyFor, issuer, audience, ...(options.now ? { now: options.now } : {}) });
      const email = typeof claims?.[emailClaim] === 'string' ? claims[emailClaim].toLowerCase() : undefined;
      if (!claims || !email) return undefined;
      if (allow.length && !allow.some((entry) => (entry.startsWith('@') ? email.endsWith(entry) : email === entry))) return undefined;
      return { id: email, email, ...(typeof claims.name === 'string' ? { name: claims.name } : {}) };
    },
  };
}
