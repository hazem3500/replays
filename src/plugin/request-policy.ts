import { PluginError } from './errors.ts';
import type { Owned } from './registry.ts';
import type { RequestPolicy, UploadEndpoint } from './types.ts';

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const PATH = /^\/api\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
const invalid = (message: string): never => {
  throw new PluginError('invalid-registration', message);
};

export function validateRequestPolicy(policy: RequestPolicy): RequestPolicy {
  if (!policy || typeof policy.path !== 'string' || !PATH.test(policy.path)) invalid('requestPolicy needs an exact canonical /api/ path');
  if (!Array.isArray(policy.methods) || !policy.methods.length || policy.methods.some((method) => !METHODS.has(method)))
    invalid('requestPolicy methods must be explicit uppercase application HTTP methods');
  if (!Array.isArray(policy.origins) || !policy.origins.length) invalid('requestPolicy needs explicit http(s) origins');
  for (const origin of policy.origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      invalid('requestPolicy needs explicit http(s) origins');
    }
    if (!['http:', 'https:'].includes(parsed!.protocol) || parsed!.origin !== origin || origin.includes('*'))
      invalid('requestPolicy needs serialized exact http(s) origins without paths, wildcards or credentials');
  }
  if (
    !Array.isArray(policy.headers) ||
    policy.headers.some((header) => typeof header !== 'string' || !TOKEN.test(header) || header.includes('*'))
  )
    invalid('requestPolicy headers must be explicit header names');
  if (policy.credentials !== undefined && typeof policy.credentials !== 'boolean') invalid('requestPolicy credentials must be boolean');
  return Object.freeze({
    path: policy.path,
    methods: Object.freeze([...new Set(policy.methods)]),
    origins: Object.freeze([...new Set(policy.origins)]),
    headers: Object.freeze([...new Set(policy.headers.map((h) => h.toLowerCase()))]),
    credentials: policy.credentials ?? false,
  });
}

/** Refuse overlapping path/method registrations so policy selection never depends on plugin order. */
export function assertDistinctPolicies(first: readonly Owned<RequestPolicy>[], second: readonly Owned<RequestPolicy>[]) {
  for (const a of first)
    for (const b of second)
      if (a.value.path === b.value.path && a.value.methods.some((method) => b.value.methods.includes(method)))
        throw new PluginError('conflict', `request policy ${b.value.path} overlaps ${a.plugin}`, { plugin: b.plugin });
}

export function validateUploadEndpoint(endpoint: UploadEndpoint): UploadEndpoint {
  if (
    !endpoint ||
    typeof endpoint.path !== 'string' ||
    !/^\/api\/[a-z][a-z0-9-]*$/.test(endpoint.path) ||
    ['/api/replays', '/api/suites', '/api/me', '/api/config', '/api/malleable'].includes(endpoint.path)
  )
    invalid('uploadEndpoint needs a distinct /api/<name> path outside core routes');
  if (endpoint.prepare !== undefined && typeof endpoint.prepare !== 'function') invalid('uploadEndpoint prepare must be a function');
  return Object.freeze({ path: endpoint.path, ...(endpoint.prepare ? { prepare: endpoint.prepare } : {}) });
}
