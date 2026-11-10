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
const PATTERN_CLASSES = new Set(['[0-9]', '[a-z]', '[a-z0-9]', '[a-z0-9-]', '[a-f0-9]']);
const PATTERN_TOKEN = /^(?:\\\.|[a-z0-9-]|(\[[^\]]*\])(?:\+|\{\d{1,2}(?:,\d{1,2})?\})?)/;
const PATTERN_TAIL = /^[a-z0-9-]*(?:\.[a-z0-9-]+){2,}$/;
const invalid = (message: string): never => {
  throw new PluginError('invalid-registration', message);
};

const policyPath = (path: unknown) => typeof path === 'string' && PATH.test(path) && !/^\/(?:internal|_plugins|assets)\//.test(path);
const ENDPOINT_HOOKS = ['prepare', 'authenticate', 'rateLimit', 'normalize', 'receipt'] as const;

/**
 * invariant: a pattern is a host shape, never a free-form regex. After `^https://` it may only hold lowercase literals,
 * escaped dots and a short list of bounded character classes, and it must end in a literal registrable suffix
 * (at least two literal labels), so no pattern can match a host outside the named domain.
 */
const badPattern = (): never =>
  invalid('requestPolicy originPatterns must be anchored ^https://...$ host patterns with escaped dots and a literal registrable suffix');
function assertOriginPattern(pattern: unknown): asserts pattern is string {
  if (typeof pattern !== 'string' || pattern.length > 200 || !pattern.startsWith('^https://') || !pattern.endsWith('$')) badPattern();
  let rest = (pattern as string).slice('^https://'.length, -1);
  let literal = '';
  while (rest) {
    const token = PATTERN_TOKEN.exec(rest);
    if (!token) return badPattern();
    if (token[1]) {
      if (!PATTERN_CLASSES.has(token[1])) badPattern();
      literal = '';
    } else literal += token[0] === '\\.' ? '.' : token[0];
    rest = rest.slice(token[0].length);
  }
  if (!PATTERN_TAIL.test(literal)) badPattern();
}

const compiled = new WeakMap<object, RegExp[]>();
const matchers = (policy: RequestPolicy) => {
  let list = compiled.get(policy);
  if (!list) compiled.set(policy, (list = (policy.originPatterns ?? []).map((pattern) => new RegExp(pattern))));
  return list;
};

/** An origin is allowed when it equals an exact entry or fully matches an anchored pattern. */
export const originAllowed = (policy: RequestPolicy, origin: string) =>
  policy.origins.includes(origin) || matchers(policy).some((matcher) => matcher.test(origin));

export function validateRequestPolicy(policy: RequestPolicy): RequestPolicy {
  if (!policy || !policyPath(policy.path)) invalid('requestPolicy needs an exact canonical application path such as /api/replays');
  if (!Array.isArray(policy.methods) || !policy.methods.length || policy.methods.some((method) => !METHODS.has(method)))
    invalid('requestPolicy methods must be explicit uppercase application HTTP methods');
  const patterns: unknown = policy.originPatterns;
  if (patterns !== undefined && !Array.isArray(patterns)) invalid('requestPolicy originPatterns must be an array');
  if (!Array.isArray(policy.origins) || (!policy.origins.length && !(patterns as unknown[] | undefined)?.length))
    invalid('requestPolicy needs explicit http(s) origins');
  for (const pattern of (patterns as unknown[] | undefined) ?? []) assertOriginPattern(pattern);
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
  const originPatterns = Object.freeze([...new Set(policy.originPatterns ?? [])]);
  const frozen = Object.freeze({
    path: policy.path,
    methods: Object.freeze([...new Set(policy.methods)]),
    origins: Object.freeze([...new Set(policy.origins)]),
    ...(originPatterns.length ? { originPatterns } : {}),
    headers: Object.freeze([...new Set(policy.headers.map((h) => h.toLowerCase()))]),
    credentials: policy.credentials ?? false,
  });
  matchers(frozen);
  return frozen;
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
