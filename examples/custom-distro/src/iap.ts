import { createHmac, timingSafeEqual } from 'node:crypto';

/*
 * A fake "IAP-style" identity header for the example: the proxy in front signs { email, aud, exp } with a secret
 * it shares with the app. Real deployments verify a JWT against the proxy's published keys instead
 * (examples/auth-signed-header); the plugin shape is the same.
 */

export const IDENTITY_HEADER = 'x-acme-identity';

export interface IdentityClaims {
  email: string;
  name?: string;
  /** An https image URL; becomes the avatar beside the person's comments. */
  avatarUrl?: string;
  aud: string;
  /** Seconds since the epoch. */
  exp: number;
}

const sign = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('base64url');

export function signIdentity(claims: IdentityClaims, secret: string) {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function verifyIdentity(token: string, options: { secret: string; audience: string; now?: number }): IdentityClaims | undefined {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return undefined;
  const expected = Buffer.from(sign(body, options.secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as Partial<IdentityClaims>;
    const now = options.now ?? Date.now() / 1000;
    if (claims.aud !== options.audience || typeof claims.email !== 'string' || typeof claims.exp !== 'number' || claims.exp <= now)
      return undefined;
    return claims as IdentityClaims;
  } catch {
    return undefined;
  }
}
