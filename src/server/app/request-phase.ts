import type { IncomingMessage, ServerResponse } from 'node:http';

import type { PluginRegistry } from '../../plugin/registry.ts';
import { runWebMiddleware } from '../api/plugin-routes.ts';
import type { Identity } from '../auth/types.ts';
import { runRequestHooks } from '../plugin-runtime.ts';

export interface RequestPhaseContext {
  request: IncomingMessage;
  response: ServerResponse;
  path: string;
  raw: URL;
  base: string;
  webRequest: () => Request;
}

/** Canonical Node then web request hooks; an answer short circuits dispatch, including authorization probes. */
export async function runRequestPhase(
  registry: PluginRegistry,
  phase: 'pre-auth' | 'post-auth',
  context: RequestPhaseContext,
  identity?: Identity,
): Promise<true | Response | undefined> {
  const { request, response, path, raw, base, webRequest } = context;
  if (await runRequestHooks(registry, phase, { request, response, path, ...(identity ? { identity } : {}) })) return true;
  const webHooks = phase === 'pre-auth' ? registry.hooks.webPreAuth : registry.hooks.webPostAuth;
  if (!webHooks.length) return undefined;
  return runWebMiddleware(registry, phase, { request: webRequest(), url: raw, path, base, ...(identity ? { identity } : {}) });
}
