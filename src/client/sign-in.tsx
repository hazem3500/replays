import { useEffect, useState } from 'react';

import { apiUrl } from './api/fetch.ts';
import { pageMeta } from './page-meta.ts';

export class SignInError extends Error {
  readonly status = 401;
  constructor() {
    super('Sign in to continue');
    this.name = 'SignInError';
  }
}

/** Available before any authenticated API fetch, including a viewer served by a public CDN. */
export function signInPath() {
  const path = pageMeta('app-sign-in');
  return path?.startsWith('/') && !path.startsWith('//') && !/[\\?#]/.test(path) ? path : undefined;
}

export function signInHref(next = `${location.pathname}${location.search}${location.hash}`) {
  const path = signInPath();
  return path ? `${path}?next=${encodeURIComponent(next)}` : undefined;
}

/** Distinguish a proxy sign-in redirect/401 from an unreachable API. Never follows the redirect. */
export async function signedOut(signal?: AbortSignal) {
  if (!signInPath()) return false;
  try {
    const response = await fetch(apiUrl('me'), {
      redirect: 'manual',
      cache: 'no-store',
      headers: { 'x-requested-with': 'XMLHttpRequest' },
      ...(signal ? { signal } : {}),
    });
    return response.type === 'opaqueredirect' || response.status === 401;
  } catch {
    return false;
  }
}

/** Only page data reads use this: uploads, mutations, media and internal rendering never redirect. */
export async function fetchPage(input: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    if (error instanceof TypeError && !init?.signal?.aborted && (await signedOut(init?.signal ?? undefined)) && !init?.signal?.aborted)
      throw new SignInError();
    throw error;
  }
  if (response.status === 401 && signInPath()) throw new SignInError();
  return response;
}

const ATTEMPT_KEY = 'replays:sign-in-attempt';
const ATTEMPT_WINDOW_MS = 60_000;

function attemptedRecently(now: number) {
  try {
    const last = sessionStorage.getItem(ATTEMPT_KEY);
    return last !== null && now - Number(last) < ATTEMPT_WINDOW_MS;
  } catch {
    return true;
  }
}

/** True while a sign-in redirect is under way, so the page shows a neutral state instead of a failure screen. */
export function useSignInRedirect(error: unknown) {
  const needed = error instanceof SignInError;
  const [redirecting, setRedirecting] = useState(false);
  const [tried, setTried] = useState(() => attemptedRecently(Date.now()));
  useEffect(() => {
    if (!needed) return;
    // oxlint-disable-next-line react/set-state-in-effect -- why: latches once the redirect starts so the screen never flips back
    if (redirectToSignIn()) setRedirecting(true);
    // why: a failure seen after mount can still hit the loop guard; then the page must offer Sign in, not wait forever.
    else setTried(true);
  }, [needed]);
  return needed && (redirecting || (signInHref() !== undefined && !tried));
}

export function redirectToSignIn(now = Date.now()) {
  const href = signInHref();
  if (!href) return false;
  if (attemptedRecently(now)) return false;
  try {
    sessionStorage.setItem(ATTEMPT_KEY, String(now));
  } catch {
    return false;
  }
  location.assign(href);
  return true;
}
