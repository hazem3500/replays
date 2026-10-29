import { delay, http, HttpResponse } from 'msw';
import type { ClientConfig } from '../../src/client/config.ts';

/** The `/api` routes stories answer, matched under any origin and base path. */
const api = (path: string) => `*/api/${path}`;

const CONFIG: ClientConfig = {
  name: 'Replays',
  sourceProviders: ['github'],
  auth: 'none',
  core: '0.1.0',
  editing: { enabled: true },
  beta: { editor: true, malleable: true },
};

/** `GET /api/config`. */
export const config = (overrides: Partial<ClientConfig> = {}) =>
  http.get(api('config'), () => HttpResponse.json({ ...CONFIG, ...overrides }));

/** `GET /api/config` that never answers, for loading states. */
export const configPending = () =>
  http.get(api('config'), async () => {
    await delay('infinite');
    return HttpResponse.json(CONFIG);
  });

/** `GET /api/config` failing with `status`. */
export const configFails = (status = 503) => http.get(api('config'), () => HttpResponse.json({ error: 'Unavailable' }, { status }));

/** `GET /api/agent-capabilities` and `GET /api/agent-credentials`. */
export const agentCredentials = (credentials: { id: string; name: string; revoked?: boolean }[] = []) => [
  http.get(api('agent-capabilities'), () =>
    HttpResponse.json({ credentials: { enabled: true, scopes: ['replays:read', 'conversations:write'], maxExpirySeconds: 2_592_000 } }),
  ),
  http.get(api('agent-credentials'), () =>
    HttpResponse.json({
      credentials: credentials.map(({ id, name, revoked }) => ({
        id,
        name,
        scopes: ['replays:read'],
        expiresAt: Date.parse('2026-12-01T00:00:00Z'),
        revokedAt: revoked ? Date.parse('2026-10-20T00:00:00Z') : null,
      })),
    }),
  ),
];
