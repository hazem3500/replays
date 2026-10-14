import type { AuthAdapter } from './types.ts';

/**
 * No authentication: every request is the same anonymous user. For local use and for deployments that already sit
 * behind something that decides who may connect (a VPN, a private network). `x-dev-user` / `DEV_USER` give the
 * identity a name, which is handy when trying the "kept by" feature.
 */
export function noneAuth(env: NodeJS.ProcessEnv = process.env): AuthAdapter {
  const fallback = env.DEV_USER?.trim() || 'anonymous';
  return {
    name: 'none',
    authenticate(request) {
      const header = request.headers['x-dev-user'];
      const id = typeof header === 'string' && header.trim() ? header.trim().slice(0, 200) : fallback;
      return { id, ...(id.includes('@') ? { email: id } : {}) };
    },
  };
}
