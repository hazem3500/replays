import { PluginError } from './errors.ts';
import type { Owned } from './registry.ts';
import type { RequestPolicy, UploadEndpoint } from './types.ts';

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const PATH = /^(?:\/[A-Za-z0-9_-]+){2,8}$/;
const ENDPOINT_PATH = /^(?:\/[a-z0-9][a-z0-9-]*){2,8}$/;
/** invariant: an endpoint never shadows a core, auth, asset or internal route, at any depth below it. */
const RESERVED = [
  '/api/replays',
  '/api/suites',
  '/api/me',
  '/api/config',
  '/api/cli',
  '/api/malleable',
  '/api/sign-in',
  '/auth',
  '/internal',
  '/_plugins',
  '/assets',
  '/r',
  '/healthz',
];
const reserved = (path: string) =>
  RESERVED.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)) || path.startsWith('/api/agent-');
const invalid = (message: string): never => {
  throw new PluginError('invalid-registration', message);
};

const policyPath = (path: unknown) => typeof path === 'string' && PATH.test(path) && !/^\/(?:internal|_plugins|assets)\//.test(path);
const ENDPOINT_HOOKS = ['prepare', 'authenticate', 'rateLimit', 'normalize', 'receipt'] as const;

export function validateRequestPolicy(policy: RequestPolicy): RequestPolicy {
  if (!policy || !policyPath(policy.path)) invalid('requestPolicy needs an exact canonical application path such as /api/replays');
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

function assertEndpointShape(endpoint: UploadEndpoint) {
  const path: unknown = endpoint?.path;
  if (typeof path !== 'string' || path.length > 200 || !ENDPOINT_PATH.test(path) || reserved(path))
    invalid('uploadEndpoint needs a distinct lowercase path of 2 to 8 segments outside core routes, such as /api/recordings');
  for (const hook of ENDPOINT_HOOKS)
    if (endpoint[hook] !== undefined && typeof endpoint[hook] !== 'function') invalid(`uploadEndpoint ${hook} must be a function`);
  const { maxBytes } = endpoint;
  if (maxBytes !== undefined && typeof maxBytes !== 'function' && !(Number.isSafeInteger(maxBytes) && maxBytes > 0))
    invalid('uploadEndpoint maxBytes must be a positive whole number of bytes or a function');
}

export function validateUploadEndpoint(endpoint: UploadEndpoint): UploadEndpoint {
  assertEndpointShape(endpoint);
  const { path, prepare, authenticate, maxBytes, rateLimit, normalize, receipt } = endpoint;
  return Object.freeze({
    path,
    ...(prepare ? { prepare } : {}),
    ...(authenticate ? { authenticate } : {}),
    ...(maxBytes === undefined ? {} : { maxBytes }),
    ...(rateLimit ? { rateLimit } : {}),
    ...(normalize ? { normalize } : {}),
    ...(receipt ? { receipt } : {}),
  });
}
