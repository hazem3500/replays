import type { PluginRegistry } from '../../plugin/registry.ts';
import type { NormalizeUploadContext, UploadEndpoint, UploadEndpointContext } from '../../plugin/types.ts';
import { tooManyRequests } from '../../shared/http-error.ts';
import type { ReplayBundle } from '../../shared/replay.ts';
import type { Identity } from '../auth/types.ts';
import { MAX_REPLAY_BYTES } from './upload-checks.ts';

const VIDEO_PATH = /^\/api\/replays\/[a-z0-9][a-z0-9-]{0,79}\/video$/;

/** The registered upload endpoint at a canonical path, if any. */
export function uploadEndpointAt(registry: PluginRegistry, path: string): UploadEndpoint | undefined {
  return registry.uploadEndpoints.get(path)?.value;
}

/** An endpoint's own identity may only post to that endpoint, whatever its resolver returned. */
export function confineToEndpoint(identity: Identity, path: string): Identity {
  return { ...identity, capabilities: { routes: [{ method: 'POST', path }] } };
}

/**
 * Whether `identity` may make this request at all: its `capabilities`, then the upload-only `replays:upload` scope
 * (canonical and registered uploads, the replay's video, the CLI status probe). Unrestricted identities pass.
 */
export function routeAllowed(registry: PluginRegistry, identity: Identity, method: string, path: string): string | undefined {
  if (identity.capabilities && !identity.capabilities.routes.some((grant) => grant.method === method && grant.path === path))
    return 'identity cannot access this route';
  if (!identity.authScopes?.includes('replays:upload')) return undefined;
  const upload =
    (method === 'POST' && (path === '/api/replays' || registry.uploadEndpoints.has(path))) ||
    (method === 'PUT' && VIDEO_PATH.test(path)) ||
    (method === 'GET' && path === '/api/cli/auth/status');
  return upload ? undefined : 'upload token cannot access this route';
}

/** The endpoint's body cap for this request; the default for core uploads. */
export async function uploadLimit(endpoint: UploadEndpoint | undefined, context: UploadEndpointContext): Promise<number> {
  const limit = typeof endpoint?.maxBytes === 'function' ? await endpoint.maxBytes(context) : (endpoint?.maxBytes ?? MAX_REPLAY_BYTES);
  // invariant: a broken host limit fails closed instead of reading an unbounded body.
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error(`upload endpoint ${context.path}: maxBytes returned ${String(limit)}`);
  return limit;
}

/** Throws the endpoint's `429` before the body is read. */
export async function enforceRateLimit(endpoint: UploadEndpoint | undefined, context: UploadEndpointContext) {
  const decision = await endpoint?.rateLimit?.(context);
  if (decision) throw tooManyRequests(decision.retryAfter, decision.message);
}

/**
 * The endpoint's `normalize`, then every `normalizeUpload` hook, each on the previous result. True in `changed` when
 * any ran, so the caller validates the result again before the privacy pass.
 */
export async function normalizeUpload(
  registry: PluginRegistry,
  endpoint: UploadEndpoint | undefined,
  bundle: ReplayBundle,
  context: Omit<NormalizeUploadContext, 'bundle'>,
): Promise<{ bundle: ReplayBundle; changed: boolean }> {
  const hooks = [...(endpoint?.normalize ? [endpoint.normalize] : []), ...registry.hooks.normalizeUpload.map((hook) => hook.value)];
  let current = bundle;
  for (const hook of hooks) current = (await hook({ ...context, bundle: current })) ?? current;
  return { bundle: current, changed: hooks.length > 0 };
}

/** The `201` body: the endpoint's receipt, else the core's `{ id, url }`. */
export function uploadReceipt(
  endpoint: UploadEndpoint | undefined,
  context: UploadEndpointContext & { bundle: ReplayBundle; url: string; publicOrigin?: string | undefined },
  core: Record<string, unknown>,
): Record<string, unknown> {
  if (!endpoint?.receipt) return core;
  const { publicOrigin, ...rest } = context;
  return endpoint.receipt({ ...rest, replayUrl: publicOrigin ? new URL(context.url, publicOrigin).href : context.url });
}
