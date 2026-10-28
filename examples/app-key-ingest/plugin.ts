import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import { definePlugin, HttpError, tooManyRequests, type Identity } from '../../src/plugin/index.ts';

/** One app allowed to upload directly from its own pages or servers. */
export interface IngestApp {
  /** `[a-z][a-z0-9-]{0,39}`; becomes the identity `app:<id>` and the replay tag `app:<id>`. */
  id: string;
  /** Active keys. Two during a rotation: add the new one, ship it, then remove the old one. */
  keys: readonly string[];
  enabled?: boolean;
  /** Exact browser origins this app's pages upload from. */
  origins: readonly string[];
  /** Accept requests without an `Origin` (the app's own backend). Default false. */
  allowServerSide?: boolean;
  /** Default 25 MiB. */
  maxBytes?: number;
  /** Whole days to keep this app's replays. */
  retentionDays?: number;
}

export interface AppKeyIngestOptions {
  apps: readonly IngestApp[];
  /** Default `/api/ingest/v1/recordings`; exempt exactly this path from the staff gateway (IAP). */
  path?: string;
  header?: string;
  perKey?: { requests: number; windowSeconds: number };
  perIp?: { requests: number; windowSeconds: number };
  /** The client address, e.g. the last `X-Forwarded-For` hop your load balancer appends. Default: the socket peer. */
  clientIp?: (request: IncomingMessage) => string;
}

/**
 * Fixed-window counters in this process. Several replicas each count separately, so a deployment that scales out needs
 * a shared store (Redis, Memorystore) behind the same `take` shape.
 */
function windowLimiter({ requests, windowSeconds }: { requests: number; windowSeconds: number }) {
  const windows = new Map<string, { start: number; count: number }>();
  return (key: string, now = Date.now()) => {
    const span = windowSeconds * 1000;
    const current = windows.get(key);
    const window = current && now - current.start < span ? current : { start: now, count: 0 };
    window.count += 1;
    windows.set(key, window);
    if (windows.size > 10_000) for (const [name, entry] of windows) if (now - entry.start >= span) windows.delete(name);
    return window.count > requests ? (window.start + span - now) / 1000 : 0;
  };
}

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Why a known app's request is refused, if it is: disabled, or an `Origin` (or none) the app does not allow. */
function refusalFor(app: IngestApp, origin: string | undefined) {
  if (app.enabled === false) return 'app is disabled';
  const allowed = origin === undefined ? app.allowServerSide === true : app.origins.includes(origin);
  return allowed ? undefined : 'origin not allowed for this app';
}

/** One audit line per accepted or refused request: outcome, app and client address, never the payload or the key. */
const audit = (outcome: string, detail: Record<string, unknown>) =>
  process.stdout.write(`${JSON.stringify({ event: 'ingest', outcome, ...detail })}\n`);

/** A public app-key ingest built only from upload-endpoint hooks; see docs/extension-api.md#custom-upload-endpoints. */
export function appKeyIngest(options: AppKeyIngestOptions) {
  const path = options.path ?? '/api/ingest/v1/recordings';
  const header = (options.header ?? 'x-replays-app-key').toLowerCase();
  const perKey = windowLimiter(options.perKey ?? { requests: 60, windowSeconds: 60 });
  const perIp = windowLimiter(options.perIp ?? { requests: 10, windowSeconds: 60 });
  const clientIp = options.clientIp ?? ((request: IncomingMessage) => request.socket.remoteAddress ?? 'unknown');
  const keys = options.apps.flatMap((app) => app.keys.map((key) => ({ app, key: digest(key) })));
  const appOf = (identity: Identity) => options.apps.find((app) => `app:${app.id}` === identity.id);

  return definePlugin({
    name: 'app-key-ingest',
    setup(api) {
      const origins = [...new Set(options.apps.flatMap((app) => app.origins))];
      if (origins.length) api.requestPolicy({ path, methods: ['POST'], origins, headers: ['content-type', 'content-encoding', header] });
      api.uploadEndpoint({
        path,
        authenticate(request) {
          const ip = clientIp(request);
          const wait = perIp(ip);
          if (wait) {
            audit('rate-limited', { ip });
            throw tooManyRequests(wait);
          }
          const presented = request.headers[header];
          // why: compare digests in constant time so response timing does not reveal a key prefix.
          const match = typeof presented === 'string' ? keys.find(({ key }) => timingSafeEqual(key, digest(presented))) : undefined;
          if (!match) {
            audit('unknown-key', { ip });
            return;
          }
          const { app } = match;
          const refusal = refusalFor(app, request.headers.origin);
          audit(refusal ? 'refused' : 'authenticated', { ip, app: app.id, ...(refusal ? { reason: refusal } : {}) });
          if (refusal) throw new HttpError(403, refusal);
          return { id: `app:${app.id}`, name: app.id };
        },
        rateLimit: ({ identity }) => {
          const wait = perKey(identity.id);
          return wait ? { retryAfter: wait } : undefined;
        },
        maxBytes: ({ identity }) => appOf(identity)?.maxBytes ?? 25 * 1024 * 1024,
        normalize({ bundle, identity }) {
          // why: people, purpose, suite membership and context are the host's to set, never the client's.
          const { people: _people, purpose: _purpose, ...meta } = bundle.meta;
          const { suiteRun: _suiteRun, context: _context, ...rest } = bundle;
          return {
            ...rest,
            meta: {
              ...meta,
              id: `${identity.id.slice('app:'.length)}-${new Date().toISOString().slice(0, 10)}-${randomBytes(6).toString('hex')}`,
              title: meta.title.slice(0, 200),
              source: 'human',
              tags: [identity.id],
            },
          };
        },
        receipt: ({ bundle, replayUrl, identity }) => {
          audit('accepted', { app: identity.name, id: bundle.meta.id });
          return { id: bundle.meta.id, reference: bundle.meta.id.slice(-12).toUpperCase(), replayUrl };
        },
      });
      api.retention({
        days: (summary) => options.apps.find((app) => summary.tags?.includes(`app:${app.id}`))?.retentionDays,
      });
    },
  });
}
