import type { IncomingMessage, ServerResponse } from 'node:http';

import { sendJson } from './http/send.ts';
import type { ReplayStore } from './store.ts';

/**
 * `GET|PUT|DELETE /api/replays/<id>/keep` and `/api/suites/<id>/keep`, behind the auth adapter
 * like the rest of the app (and the same-origin check for writes). PUT keeps (no expiry), recording the
 * signed-in identity; DELETE lets retention apply again; all three answer the retention
 * `{ kept?: { by, at }, expiresAt: string | null }`. Returns false when `path` is not a keep route.
 */
export async function handleKeepApi(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  options: { store: ReplayStore; user: string },
) {
  const match = /^\/api\/(replays|suites)\/([a-z0-9][a-z0-9-]{0,79})\/keep$/.exec(path);
  if (!match) return false;
  const suite = match[1] === 'suites';
  const id = match[2]!;
  const { store } = options;
  let retention;
  switch (request.method) {
    case 'GET':
    case 'HEAD':
      retention = suite ? await store.suiteRetention(id) : await store.replayRetention(id);
      if (!retention) {
        sendJson(response, 404, { error: `${suite ? 'review suite' : 'replay'} not found` });
        return true;
      }
      break;
    case 'PUT':
      retention = suite ? await store.keepSuite(id, options.user) : await store.keep(id, options.user);
      console.log(`keep ${suite ? 'suite ' : ''}${id}: kept by ${options.user}`);
      break;
    case 'DELETE':
      retention = suite ? await store.unkeepSuite(id) : await store.unkeep(id);
      console.log(`keep ${suite ? 'suite ' : ''}${id}: released by ${options.user}`);
      break;
    default:
      sendJson(response, 405, { error: 'method not allowed' });
      return true;
  }
  sendJson(response, 200, retention);
  return true;
}
