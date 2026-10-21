import type { IncomingMessage, ServerResponse } from 'node:http';

import { definePlugin } from '../plugin/define.ts';
import { sanitizeUrlFields } from '../capture/sanitize.ts';
import { BRIDGE_TOOLS } from '../shared/malleable-tools.ts';
import { isScope, parseManifest, parseSource, PluginFormatError, type PluginScope, type UserPluginManifest } from '../shared/malleable.ts';
import { defaultPolicy, type HostVersions, type MalleablePolicy, policyProblems, targetsFor } from '../shared/malleable-policy.ts';
import { SANDBOX_CSP, SANDBOX_HTML, SANDBOX_PATH } from '../shared/sandbox-runtime.ts';
import { send } from './app.ts';
import type { Identity } from './auth/types.ts';
import { BridgeError, BridgeHub } from './bridge-hub.ts';
import { ApprovalBook, PluginStoreError, UserPluginStore } from './malleable-store.ts';
import { coreVersion } from './package-info.ts';
import type { ObjectStorage } from './storage/types.ts';

const JSON_TYPE = 'application/json; charset=utf-8';
const MAX_BODY = 192 * 1024;
export const MALLEABLE_PLUGIN = 'malleable';

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY) throw new PluginStoreError(413, 'request too large');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* falls through */
  }
  throw new PluginStoreError(400, 'send a JSON object');
}

const reply = (response: ServerResponse, status: number, body: unknown) =>
  send(response, status, JSON.stringify(body), JSON_TYPE, 'private, no-store');

function bearer(request: IncomingMessage) {
  const header = request.headers.authorization;
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
}

function fail(response: ServerResponse, error: unknown) {
  if (error instanceof PluginFormatError) return reply(response, 400, { error: error.message });
  if (error instanceof PluginStoreError || error instanceof BridgeError) return reply(response, error.status, { error: error.message });
  throw error;
}

/**
 * User plugins and the agent bridge, as a built-in plugin loaded only with `beta.malleable`
 * (REPLAYS_BETA_MALLEABLE): with the flag off the plugin does not exist, so none of these paths do either.
 *
 * pre-auth (no session, by design):
 *   GET  /_malleable/sandbox.html           the page a plugin runs in, with its CSP header (contains no data)
 *   POST /api/malleable/bridge/call         an agent's tool call, authorised by the bridge bearer token alone
 *   GET  /api/malleable/bridge/tools        the tool list (also bearer)
 * post-auth (the auth adapter, then the same-origin check for writes):
 *   GET    /api/malleable/plugins[?scope=]  summaries            GET /api/malleable/plugins/<scope>/<id>   full history
 *   POST   /api/malleable/approvals         consent token for a save or delete (the dialog's Approve)
 *   PUT    /api/malleable/plugins/<scope>/<id>   append a version; needs `approval`
 *   DELETE /api/malleable/plugins/<scope>/<id>?approval=…
 *   POST   /api/malleable/bridge/pair       DELETE /api/malleable/bridge?token=…
 *   GET    /api/malleable/bridge/events?token=…   (SSE) the tab's stream   POST …/bridge/results  the tab's answers
 *
 * The host's policy (src/shared/malleable-policy.ts) narrows all of it: a scope it turned off is neither listed nor kept,
 * and a manifest that declares a capability it denies is refused (403) before an approval is minted or spent. Every
 * saved version records the core and distribution versions it was kept under (`manifest.targets`).
 */
export function malleablePlugin(deps: {
  storage: ObjectStorage;
  anonymous: boolean;
  hub?: BridgeHub;
  approvals?: ApprovalBook;
  /** The host's policy (`malleable` in the config): enforced on every save, and on which scopes are listed. */
  policy?: MalleablePolicy;
  /** Recorded as `manifest.targets` on every saved version. */
  versions?: HostVersions;
}) {
  const store = new UserPluginStore(deps.storage);
  const policy = deps.policy ?? defaultPolicy();
  const versions = deps.versions ?? { core: coreVersion() };
  /** The host narrows: a scope it turned off, or a capability it denies, is refused before any approval is spent. */
  const allowed = (manifest: UserPluginManifest, scope: PluginScope) => {
    const problems = policyProblems(policy, manifest, scope);
    if (problems.length) throw new PluginStoreError(403, `not kept: ${problems.join('; ')}`);
  };
  const hub = deps.hub ?? new BridgeHub();
  const approvals = deps.approvals ?? new ApprovalBook();
  const displayName = (user: Identity) => (deps.anonymous ? 'Anonymous' : (user.name ?? user.email ?? user.id)).slice(0, 120);

  return definePlugin({
    name: MALLEABLE_PLUGIN,
    order: -90,
    setup(api) {
      api.onRequest(
        async ({ request, response, path }) => {
          const method = request.method ?? 'GET';
          if (path === SANDBOX_PATH && (method === 'GET' || method === 'HEAD')) {
            response.writeHead(200, {
              'content-type': 'text/html; charset=utf-8',
              'content-security-policy': SANDBOX_CSP,
              'cache-control': 'no-cache',
              'x-content-type-options': 'nosniff',
              'referrer-policy': 'no-referrer',
            });
            response.end(method === 'HEAD' ? undefined : SANDBOX_HTML);
            return true;
          }
          if (path === '/api/malleable/bridge/tools' && method === 'GET') {
            if (!hub.connected(bearer(request))) return reply(response, 401, { error: 'unknown token or no viewer connected' }), true;
            reply(response, 200, { tools: BRIDGE_TOOLS });
            return true;
          }
          if (path === '/api/malleable/bridge/call' && method === 'POST') {
            try {
              const body = await readBody(request);
              if (typeof body.tool !== 'string' || !BRIDGE_TOOLS.some((tool) => tool.name === body.tool))
                throw new PluginStoreError(400, 'unknown tool');
              reply(response, 200, { result: await hub.call(bearer(request), body.tool, body.arguments) });
            } catch (error) {
              fail(response, error);
            }
            return true;
          }
          return false;
        },
        { phase: 'pre-auth' },
      );

      api.onRequest(async ({ request, response, path, identity }) => {
        if (!identity || !path.startsWith('/api/malleable/')) return false;
        const method = request.method ?? 'GET';
        const rest = path.slice('/api/malleable/'.length);
        try {
          if (rest === 'plugins' && method === 'GET') {
            const scope = new URL(request.url ?? '/', 'http://x').searchParams.get('scope');
            if (scope !== null && !isScope(scope)) throw new PluginStoreError(400, 'scope is user or workspace');
            // A scope the host turned off is not listed, so its plugins do not load (they stay stored, untouched).
            const scopes = (scope ? [scope] : (['user', 'workspace'] as PluginScope[])).filter((entry) => policy.scopes.includes(entry));
            const lists = await Promise.all(scopes.map((entry) => store.list(entry, identity.id)));
            reply(response, 200, { plugins: lists.flat() });
            return true;
          }
          const one = /^plugins\/(user|workspace)\/([a-z][a-z0-9-]{0,31})$/.exec(rest);
          if (one) {
            const scope = one[1] as PluginScope;
            const id = one[2]!;
            if (method === 'GET') {
              if (!policy.scopes.includes(scope)) throw new PluginStoreError(404, 'no such plugin');
              const history = await store.history(scope, identity.id, id);
              if (!history) throw new PluginStoreError(404, 'no such plugin');
              reply(response, 200, history);
              return true;
            }
            if (method === 'PUT') {
              const body = await readBody(request);
              const manifest = parseManifest(body.manifest);
              const source = parseSource(body.source);
              allowed(manifest, scope);
              const digest = ApprovalBook.digest('save', scope, id, manifest, source);
              if (!approvals.consume(body.approval, identity.id, digest))
                throw new PluginStoreError(
                  403,
                  'saving needs the person’s approval for exactly this content (POST /api/malleable/approvals)',
                );
              const baseVersion = typeof body.baseVersion === 'number' && Number.isInteger(body.baseVersion) ? body.baseVersion : -1;
              const message = typeof body.message === 'string' ? (sanitizeUrlFields(body.message) as string) : '';
              const version = await store.save(scope, identity.id, id, {
                // What it was kept under, from the server's own versions (a client's `targets` is not trusted).
                manifest: { ...manifest, targets: targetsFor(versions) },
                source,
                message,
                by: displayName(identity),
                baseVersion,
              });
              console.log(`malleable: ${scope} plugin ${id} saved as version ${version.n} by ${displayName(identity)}`);
              reply(response, 200, { version: version.n, sha256: version.sha256 });
              return true;
            }
            if (method === 'DELETE') {
              const token = new URL(request.url ?? '/', 'http://x').searchParams.get('approval');
              if (!approvals.consume(token, identity.id, ApprovalBook.digest('delete', scope, id)))
                throw new PluginStoreError(403, 'deleting needs the person’s approval');
              reply(response, 200, { removed: await store.remove(scope, identity.id, id) });
              return true;
            }
          }
          if (rest === 'approvals' && method === 'POST') {
            const body = await readBody(request);
            if ((body.action !== 'save' && body.action !== 'delete') || !isScope(body.scope) || typeof body.id !== 'string')
              throw new PluginStoreError(400, 'send { action: "save" | "delete", scope, id, manifest?, source? }');
            const save = body.action === 'save';
            const manifest = save ? parseManifest(body.manifest) : undefined;
            const source = save ? parseSource(body.source) : undefined;
            if (manifest) allowed(manifest, body.scope);
            reply(response, 200, approvals.mint(identity.id, ApprovalBook.digest(body.action, body.scope, body.id, manifest, source)));
            return true;
          }
          if (rest === 'bridge/pair' && method === 'POST') {
            reply(response, 200, hub.pair(identity.id));
            return true;
          }
          if (rest === 'bridge' && method === 'DELETE') {
            const token = new URL(request.url ?? '/', 'http://x').searchParams.get('token');
            if (token) hub.revoke(token);
            reply(response, 200, { revoked: true });
            return true;
          }
          if (rest === 'bridge/events' && method === 'GET') {
            hub.attach(new URL(request.url ?? '/', 'http://x').searchParams.get('token'), identity.id, response);
            return true;
          }
          if (rest === 'bridge/results' && method === 'POST') {
            const body = await readBody(request);
            hub.answer(body.token, identity.id, body.id, {
              ok: body.ok === true,
              result: body.result,
              ...(typeof body.error === 'string' ? { error: body.error } : {}),
            });
            reply(response, 200, { ok: true });
            return true;
          }
          return false;
        } catch (error) {
          fail(response, error);
          return true;
        }
      });
    },
  });
}
