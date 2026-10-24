/** A canonical sign-in return endpoint, without the deployment base. No secrets go to the viewer. */
export interface SignInConfig {
  path: string;
}

/** Only dedicated auth paths may become return endpoints; never shadow uploads or internal routes. */
export function normalizeSignIn(value: unknown): SignInConfig | undefined {
  if (value === undefined || value === false) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => key !== 'path'))
    throw new Error('signIn must be false or { path }');
  const path = (value as SignInConfig).path;
  if (typeof path !== 'string' || path.length > 200 || !/^(\/api\/sign-in|\/auth\/[a-z0-9-]+(?:\/[a-z0-9-]+)*)$/.test(path))
    throw new Error('signIn.path must be /api/sign-in or a canonical /auth/... path');
  return { path };
}

/** A normalized path on this origin. Dot segments and backslashes must not turn it into a // redirect. */
export function signInReturn(next: string | null, fallback: string) {
  if (!next?.startsWith('/')) return fallback;
  const url = new URL(next, 'http://replays.invalid');
  const path = `${url.pathname}${url.search}${url.hash}`;
  return url.origin === 'http://replays.invalid' && !path.startsWith('//') ? path : fallback;
}
