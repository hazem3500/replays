import type { IncomingMessage, ServerResponse } from 'node:http';

import type { PluginRegistry, ResolvedClientEntry } from '../plugin/registry.ts';
import type { ContextInfo } from '../plugin/types.ts';
import type { ReplayContext } from '../shared/context.ts';
import type { ReplayBundle } from '../shared/replay.ts';
import type { Identity } from './auth/types.ts';

/*
 * The request-time half of the plugin system: runs the hooks and adapters that src/plugin/registry.ts collected.
 * app.ts calls these at fixed points (pre-auth, post-auth, around uploads, on response).
 */

const log = (plugin: string, what: string, error: unknown) =>
  console.error(`plugin ${plugin}: ${what} failed:`, error instanceof Error ? error.message : error);

/** Runs request hooks in plugin order; true as soon as one answered the request. */
export async function runRequestHooks(
  registry: PluginRegistry,
  phase: 'pre-auth' | 'post-auth',
  context: { request: IncomingMessage; response: ServerResponse; path: string; identity?: Identity },
) {
  for (const hook of phase === 'pre-auth' ? registry.hooks.preAuth : registry.hooks.postAuth) {
    if ((await hook.value(context)) === true) return true;
  }
  return false;
}

/** Calls the `onResponse` hooks once the response is done. Hook errors are logged, never thrown. */
export function watchResponse(
  registry: PluginRegistry,
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  identity: () => Identity | undefined,
) {
  if (!registry.hooks.response.length) return;
  const started = performance.now();
  response.once('close', () => {
    const who = identity();
    const info = {
      method: request.method ?? 'GET',
      path,
      status: response.statusCode,
      durationMs: Math.round(performance.now() - started),
      ...(who ? { identity: who } : {}),
    };
    for (const hook of registry.hooks.response)
      Promise.resolve()
        .then(() => hook.value(info))
        .catch((error: unknown) => log(hook.plugin, 'onResponse', error));
  });
}

/** The request a hook sees, as the Node request (deprecated in the hook API) and as a web `Request`. */
export interface HookRequests {
  request: IncomingMessage;
  webRequest: Request;
}

/**
 * Passes the producer's context through every adapter, in order. The caller resolves the sources, applies the schema
 * and validates the result like any producer's context, so an adapter cannot smuggle data past the core checks.
 */
export async function applyContextAdapters(
  registry: PluginRegistry,
  context: ReplayContext | undefined,
  info: ContextInfo,
): Promise<ReplayContext | undefined> {
  let current = context;
  for (const adapter of registry.contextAdapters) {
    if (!adapter.value.normalize) continue;
    try {
      current = await adapter.value.normalize(current, info);
    } catch (error) {
      if ((error as { status?: unknown }).status !== undefined) throw error;
      log(adapter.plugin, `context adapter ${adapter.value.name}`, error);
      throw Object.assign(new Error(`context adapter ${adapter.value.name} failed`), { status: 500 });
    }
  }
  return current;
}

/** `prepareUpload` hooks in order, on the raw parsed body. */
export async function runPrepareUpload(registry: PluginRegistry, body: unknown, identity: Identity, requests: HookRequests) {
  let current = body;
  for (const hook of registry.hooks.prepareUpload) current = await hook.value({ body: current, identity, ...requests });
  return current;
}

/** `beforeUpload` hooks in order; each may return a replacement bundle. Throw from a hook to refuse the upload. */
export async function runBeforeUpload(registry: PluginRegistry, bundle: ReplayBundle, identity: Identity, requests: HookRequests) {
  let current = bundle;
  for (const hook of registry.hooks.beforeUpload) {
    const replaced = await hook.value({ bundle: current, identity, ...requests });
    if (replaced) current = replaced;
  }
  return current;
}

/** `afterUpload` hooks, in the background of the response's critical path (awaited, errors logged). */
export async function runAfterUpload(
  registry: PluginRegistry,
  bundle: ReplayBundle,
  identity: Identity,
  requests: HookRequests,
  url: string,
) {
  for (const hook of registry.hooks.afterUpload) {
    try {
      await hook.value({ bundle, identity, ...requests, url });
    } catch (error) {
      log(hook.plugin, 'afterUpload', error);
    }
  }
}

const SCRIPT_URL = /^\/_plugins\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)\.(js|css)$/;

/** The entry a `/_plugins/<plugin>/<id>.js|css` path names, with the file to serve; undefined for https entries. */
export function clientAsset(registry: PluginRegistry, path: string) {
  const match = SCRIPT_URL.exec(path);
  if (!match) return undefined;
  const entry = registry.clientEntries.find((candidate) => candidate.plugin === match[1] && candidate.id === match[2]);
  const file = match[3] === 'js' ? entry?.script : entry?.style;
  if (!entry || !file || file.startsWith('https://')) return undefined;
  return { file, contentType: match[3] === 'js' ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' };
}

export interface PublicClientEntry {
  plugin: string;
  id: string;
  script: string;
  style?: string;
}

/** What the page tells the browser to load: served entries by their app URL, https entries as they are. */
export function publicClientEntries(entries: readonly ResolvedClientEntry[], base: string): PublicClientEntry[] {
  const url = (entry: ResolvedClientEntry, file: string, extension: 'js' | 'css') =>
    file.startsWith('https://') ? file : `${base}/_plugins/${entry.plugin}/${entry.id}.${extension}`;
  return entries.map((entry) => ({
    plugin: entry.plugin,
    id: entry.id,
    script: url(entry, entry.script, 'js'),
    ...(entry.style ? { style: url(entry, entry.style, 'css') } : {}),
  }));
}
