import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { defineAction } from '@agent-native/core';
import { awaitBootstrap, markDefaultPluginProvided, mountActionRoutes } from '@agent-native/core/server';
import { H3 } from 'h3';

import type { Identity } from '../auth/types.ts';
import type { ReplayStore } from '../store.ts';
import { AgentCredentials, AGENT_SCOPES, MAX_CREDENTIAL_LIFETIME_SECONDS, type AgentScope } from './credentials.ts';
import { openApplicationRecords, type ApplicationOwner, type ApplicationRecords } from './records.ts';

export interface ApplicationOptions {
  /** PostgreSQL only; absent means conversation/credential capabilities are unavailable. */
  databaseUrl?: string;
  /** A deployment-owned workspace key. Never read from client headers. */
  workspaceId?: string;
  /** Off unless explicitly selected by the host. Requires PostgreSQL. */
  credentials?: boolean;
}
interface Invocation {
  owner: ApplicationOwner;
  frameworkOwner: string;
  identity: Identity;
  signal: AbortSignal;
  scopes?: AgentScope[];
}
const invocation = new AsyncLocalStorage<Invocation>();
const current = () => {
  const value = invocation.getStore();
  if (!value) throw new Error('An authenticated host request is required');
  return value;
};
function refuse(status: number, message: string): never {
  throw Object.assign(new Error(message), { status, statusCode: status });
}
const json = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
};
async function body(request: IncomingMessage, signal: AbortSignal) {
  signal.throwIfAborted();
  const cancel = () => request.destroy(signal.reason instanceof Error ? signal.reason : new Error('Request cancelled'));
  signal.addEventListener('abort', cancel, { once: true });
  try {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      signal.throwIfAborted();
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > 16_384) refuse(413, 'Request body too large');
      chunks.push(bytes);
    }
    signal.throwIfAborted();
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      return refuse(400, 'Invalid JSON');
    }
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

/** Mounted behind the existing host's authentication, CSRF and plugin request policy. */
export interface ApplicationRuntime {
  authorize(request: IncomingMessage, path: string, identity: Identity): Promise<void>;
  handle(request: IncomingMessage, response: ServerResponse, path: string, identity: Identity): Promise<boolean>;
  close(): Promise<void>;
}

export async function createApplicationRuntime(
  store: ReplayStore,
  authName: string,
  options: ApplicationOptions = {},
): Promise<ApplicationRuntime> {
  const workspaceId = options.workspaceId?.trim() || 'default';
  let records: ApplicationRecords | undefined;
  if (options.databaseUrl) records = await openApplicationRecords(options.databaseUrl);
  const credentials = records && options.credentials ? new AgentCredentials(records) : undefined;
  const h3 = new H3();
  // The framework supports mounting into a host's Nitro app. Only this explicit read action is mounted;
  // claim all automatic plugin slots before bootstrap so no login, terminal, code execution or agent tools appear.
  const hooks = new Map<string, Array<(...args: unknown[]) => unknown>>();
  const nitro = {
    h3,
    fetch: h3.fetch.bind(h3),
    hooks: {
      hook(name: string, hook: (...args: unknown[]) => unknown) {
        const entries = hooks.get(name) ?? [];
        entries.push(hook);
        hooks.set(name, entries);
      },
    },
  };
  for (const stem of [
    'auth',
    'agent-chat',
    'context-xray',
    'core-routes',
    'integrations',
    'observational-memory',
    'onboarding',
    'org',
    'resources',
    'sentry',
    'terminal',
  ])
    markDefaultPluginProvided(nitro, stem);
  const inspectReplay = defineAction({
    description: 'Read replay metadata from the canonical object store.',
    parameters: { id: { type: 'string', description: 'Replay ID' } },
    readOnly: true,
    agentTool: true,
    mcpTool: false,
    http: { method: 'GET' },
    authorize: (_args, context) =>
      context?.userEmail === current().frameworkOwner && (!current().scopes || current().scopes?.includes('replays:read') === true),
    run: async ({ id }) => {
      if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) refuse(400, 'Invalid replay ID');
      const call = current();
      const read = async () => {
        call.signal.throwIfAborted();
        const summary = await store.summary(id);
        call.signal.throwIfAborted();
        if (!summary) refuse(404, 'Replay not found');
        return summary;
      };
      return records ? records.run(call.owner, 'inspect-replay', call.signal, read) : read();
    },
  });
  mountActionRoutes(
    nitro,
    { 'inspect-replay': inspectReplay },
    {
      actionRouteAuth: { resolveCaller: () => ({ owner: current().frameworkOwner, anonymous: false, orgId: null }) },
    },
  );
  await awaitBootstrap(nitro);
  const abort = new AbortController();
  const pending = new Set<Promise<boolean>>();
  const credentialScopes = new WeakMap<IncomingMessage, AgentScope[]>();
  const ownerFor = (identity: Identity): ApplicationOwner => ({ userId: identity.id, workspaceId: `${authName}:${workspaceId}` });
  async function authorize(request: IncomingMessage, path: string, identity: Identity) {
    const tokenHeader = request.headers['x-replays-agent-token'];
    if (tokenHeader === undefined) return;
    if (typeof tokenHeader !== 'string' || !credentials) refuse(401, 'Invalid agent credential');
    const verified = await credentials.verify(tokenHeader);
    const owner = ownerFor(identity);
    if (!verified || verified.owner.userId !== owner.userId || verified.owner.workspaceId !== owner.workspaceId)
      refuse(401, 'Invalid agent credential');
    const required =
      path === '/_agent-native/actions/inspect-replay' && ['GET', 'HEAD'].includes(request.method ?? '')
        ? 'replays:read'
        : path === '/api/agent-conversations' && request.method === 'GET'
          ? 'conversations:read'
          : path === '/api/agent-conversations' && request.method === 'POST'
            ? 'conversations:write'
            : undefined;
    if (!required || !verified.scopes.includes(required)) refuse(403, 'Agent credential does not authorize this operation');
    credentialScopes.set(request, verified.scopes);
  }

  async function handle(request: IncomingMessage, response: ServerResponse, path: string, identity: Identity) {
    if (abort.signal.aborted) {
      request.destroy();
      response.destroy();
      return true;
    }
    const credentialRoute = path === '/api/agent-credentials' || path.startsWith('/api/agent-credentials/');
    const frameworkRoute = path.startsWith('/_agent-native/');
    const applicationRoute = credentialRoute || path === '/api/agent-capabilities' || path === '/api/agent-conversations' || frameworkRoute;
    if (!applicationRoute) return false;
    if (request.headers['x-replays-agent-token'] !== undefined && !credentialScopes.has(request)) await authorize(request, path, identity);
    const owner = ownerFor(identity);
    const scopes = credentialScopes.get(request);
    const localAbort = new AbortController();
    const disconnected = () => {
      if (!response.writableFinished) localAbort.abort(new Error('Request disconnected'));
    };
    request.once('aborted', disconnected);
    response.once('close', disconnected);
    const signal = AbortSignal.any([abort.signal, localAbort.signal]);
    const call: Invocation = {
      owner,
      identity,
      signal,
      frameworkOwner: `host:${createHash('sha256').update(JSON.stringify(owner)).digest('hex')}`,
      ...(scopes ? { scopes } : {}),
    };
    try {
      return await invocation.run(call, async () => {
        if (path === '/api/agent-capabilities' && request.method === 'GET') {
          json(response, 200, {
            runtime: 'agent-native',
            conversations: { enabled: Boolean(records) },
            credentials: {
              enabled: Boolean(credentials),
              scopes: AGENT_SCOPES,
              maxExpirySeconds: MAX_CREDENTIAL_LIFETIME_SECONDS,
              requiresHostAuthentication: true,
            },
          });
        } else if (credentialRoute) {
          if (!credentials) refuse(503, 'Credential management is not configured');
          if (path === '/api/agent-credentials' && request.method === 'GET')
            json(response, 200, { credentials: await credentials.list(owner) });
          else if (path === '/api/agent-credentials' && request.method === 'POST')
            json(response, 201, await credentials.create(owner, await body(request, signal)));
          else if (/^\/api\/agent-credentials\/[a-f0-9-]{36}$/.test(path) && request.method === 'DELETE') {
            await credentials.revoke(owner, path.split('/').at(-1)!);
            response.writeHead(204, { 'cache-control': 'no-store' });
            response.end();
          } else refuse(405, 'Method not allowed');
        } else if (path === '/api/agent-conversations') {
          if (!records) refuse(503, 'PostgreSQL application records are not configured');
          if (request.method === 'GET') {
            if (scopes && !scopes.includes('conversations:read')) refuse(403, 'Missing conversations:read scope');
            json(response, 200, { conversations: await records.conversations(owner) });
          } else if (request.method === 'POST') {
            if (scopes && !scopes.includes('conversations:write')) refuse(403, 'Missing conversations:write scope');
            const input = await body(request, signal);
            const title = input && typeof input === 'object' && 'title' in input ? input.title : undefined;
            if (typeof title !== 'string' || !title.trim() || title.length > 200)
              refuse(400, 'Conversation title must contain 1 to 200 characters');
            json(response, 201, await records.createConversation(owner, title.trim()));
          } else refuse(405, 'Method not allowed');
        } else if (path === '/_agent-native/actions/inspect-replay' && ['GET', 'HEAD'].includes(request.method ?? '')) {
          signal.throwIfAborted();
          const query = new URL(request.url ?? '/', 'http://localhost').search;
          // No forwarded client identity/org/capability headers enter the framework dispatcher.
          const result = await h3.fetch(new Request(`http://localhost${path}${query}`, { method: request.method ?? 'GET', signal }));
          response.writeHead(result.status, {
            'content-type': result.headers.get('content-type') ?? 'application/json',
            'cache-control': 'no-store',
          });
          response.end(request.method === 'HEAD' ? undefined : Buffer.from(await result.arrayBuffer()));
        } else refuse(404, 'Unknown application operation');
        return true;
      });
    } finally {
      request.off('aborted', disconnected);
      response.off('close', disconnected);
    }
  }
  return {
    authorize,
    handle(request, response, path, identity) {
      const operation = handle(request, response, path, identity);
      pending.add(operation);
      void operation.finally(() => pending.delete(operation)).catch(() => {});
      return operation;
    },
    async close() {
      abort.abort(new Error('Application shutting down'));
      await Promise.allSettled(pending);
      await records?.close();
    },
  };
}
