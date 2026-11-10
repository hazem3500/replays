import { randomBytes } from 'node:crypto';

import { HANDOFF_CHANNEL, HANDOFF_PATH, HANDOFF_VERSION, MAX_HANDOFF_CHARS, type HandoffAllowlist } from '../../shared/upload-handoff.ts';
import { defineRoute } from '../http/route.ts';
import { text } from '../http/respond.ts';
import type { ApiServices } from './services.ts';

const escapeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

/**
 * The page's script. invariant: it acts only on a `bundle` message whose `event.source` is its opener and whose
 * `event.origin` the `/api/replays` request policy lists, uploads same-origin, and answers that origin only (never `*`).
 * Its `ready` message carries nothing secret, because the page cannot know the opener's origin before the opener answers.
 */
const PAGE_SCRIPT = String.raw`(function () {
  var CHANNEL = ${JSON.stringify(HANDOFF_CHANNEL)};
  var VERSION = ${HANDOFF_VERSION};
  var MAX = ${MAX_HANDOFF_CHARS};
  var allow = __ALLOW__;
  var status = document.getElementById('status');
  function say(message) { status.textContent = message; }
  var opener = window.opener;
  if (!opener || opener.closed) {
    say('You are signed in to Toggl Replays. Close this window, go back to the app and choose Retry.');
    return;
  }
  function allowed(origin) {
    if (allow.origins.indexOf(origin) !== -1) return true;
    return allow.originPatterns.some(function (pattern) { return new RegExp(pattern).test(origin); });
  }
  var started = false;
  function reply(origin, body) {
    opener.postMessage(Object.assign({ channel: CHANNEL, version: VERSION, type: 'receipt' }, body), origin);
  }
  function finish(message) {
    say(message);
    setTimeout(function () { window.close(); }, 600);
  }
  window.addEventListener('message', function (event) {
    if (started || event.source !== opener || !allowed(event.origin)) return;
    var data = event.data;
    if (!data || data.channel !== CHANNEL || data.version !== VERSION || data.type !== 'bundle') return;
    if (typeof data.id !== 'string' || typeof data.payload !== 'string') return;
    if (!/^[A-Za-z0-9-]{16,64}$/.test(data.id) || !data.payload.length || data.payload.length > MAX) return;
    started = true;
    var origin = event.origin;
    var id = data.id;
    say('Uploading the recording');
    fetch('api/replays', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: data.payload
    }).then(function (response) {
      if (!response.ok) {
        reply(origin, { id: id, ok: false, status: response.status });
        finish('Toggl Replays could not take the recording. You can close this window.');
        return;
      }
      return response.json().then(function (body) {
        reply(origin, { id: id, ok: true, replayId: body && body.id, url: body && typeof body.url === 'string' ? body.url : undefined });
        finish('Uploaded. This window closes by itself.');
      });
    }).catch(function () {
      reply(origin, { id: id, ok: false, status: 0 });
      finish('Could not reach Toggl Replays. You can close this window.');
    });
  });
  opener.postMessage({ channel: CHANNEL, version: VERSION, type: 'ready' }, '*');
})();`;

export function renderHandoffPage(allowlist: HandoffAllowlist, nonce: string): string {
  const script = PAGE_SCRIPT.replace('__ALLOW__', () => escapeJson(allowlist));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Upload to Toggl Replays</title>
<style nonce="${nonce}">
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; box-sizing: border-box; }
p { max-width: 32ch; text-align: center; line-height: 1.5; }
</style>
</head>
<body>
<p id="status" role="status">Waiting for the recording</p>
<script nonce="${nonce}">${script}</script>
</body>
</html>
`;
}

/** The origins that may hand a bundle over: exactly the ones the `POST /api/replays` request policy allows. */
export function handoffAllowlist({ registry }: Pick<ApiServices, 'registry'>): HandoffAllowlist {
  const policies = registry.requestPolicies.filter(({ value }) => value.path === '/api/replays' && value.methods.includes('POST'));
  return {
    origins: [...new Set(policies.flatMap(({ value }) => value.origins))],
    originPatterns: [...new Set(policies.flatMap(({ value }) => value.originPatterns ?? []))],
  };
}

/**
 * `GET /upload`: the first-party half of the upload handoff (src/shared/upload-handoff.ts). Behind the same
 * authentication as the viewer, so a browser without a Replays session is sent to sign in in this window.
 */
export function uploadHandoffRoutes(services: ApiServices) {
  return [
    defineRoute({
      method: 'GET',
      path: HANDOFF_PATH,
      handler() {
        const allowlist = handoffAllowlist(services);
        if (!allowlist.origins.length && !allowlist.originPatterns.length) return text(404, 'not found');
        const nonce = randomBytes(16).toString('base64');
        return text(200, renderHandoffPage(allowlist, nonce), {
          contentType: 'text/html; charset=utf-8',
          cacheControl: 'no-store',
          headers: {
            'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
            'referrer-policy': 'no-referrer',
            'x-content-type-options': 'nosniff',
          },
        });
      },
    }),
  ];
}
