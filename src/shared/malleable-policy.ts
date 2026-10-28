import { isRecord } from './plugin-validation.ts';
import {
  authoredManifest,
  CAPABILITIES,
  type Capability,
  isCapability,
  isScope,
  isWriteCapability,
  type PluginScope,
  type UserPluginManifest,
} from './malleable.ts';

/**
 * The host's policy for sandboxed user plugins (beta.malleable), from the `malleable` block of the config:
 *
 *   malleable: {
 *     enabled: true,                                    same switch as beta.malleable (either one; they must agree)
 *     scopes: ['user'],                                 where plugins may be kept (default: user only)
 *     capabilities: { 'export:download': 'deny' },      per capability: allow | ask | deny
 *     lockedSurfaces: ['inspector:context'],            surfaces no user plugin may replace or hide
 *   }
 *
 * The host can only NARROW what a user plugin may do: a read-only capability may be `allow` (the default), `ask` or `deny`;
 * a write capability is `ask` (the default) or `deny`, never `allow`, because a write always shows the person what it is
 * about to do. The same policy object is enforced by the server (src/server/malleable-plugin.ts: nothing is kept that
 * declares a denied capability or targets a disabled scope), by the viewer's broker (src/client/malleable/broker.ts: a
 * denied capability fails with `permission-denied`) and shown in the workshop and to agents (`get_plugin_api`).
 */
export type CapabilityRule = 'allow' | 'ask' | 'deny';

export interface MalleablePolicy {
  /** Where a plugin may be kept: `user` (only its author) and/or `workspace` (everyone signed in). */
  scopes: PluginScope[];
  /** One rule per capability. */
  capabilities: Record<Capability, CapabilityRule>;
  /** Surface ids user plugins may not replace or hide: `inspector:<tab>`, `inspector:<plugin>:<tab>`, `panel:<plugin>:<id>`, `action:<plugin>:<id>`. */
  lockedSurfaces: string[];
  workspaceRoles: string[];
  /** Optional allow list; deny always wins. Selectors are id:<id> or sha256:<hash>. */
  allow?: string[];
  deny: string[];
  watchdog: { heartbeatTimeoutMs: number; frameBudgetMs: number; maxCallsPerSecond: number };
}

/** The `malleable` key of the config file / `defineConfig()`. */
export interface MalleableConfig {
  /** Turns user plugins on, like `beta.malleable` (either may be used; if both are set they must agree). */
  enabled?: boolean;
  scopes?: PluginScope[];
  capabilities?: Partial<Record<Capability, CapabilityRule>>;
  lockedSurfaces?: string[];
  workspaceRoles?: string[];
  allow?: string[];
  deny?: string[];
  watchdog?: Partial<MalleablePolicy['watchdog']>;
}

/** What applies with no `malleable` block: user scope only, read-only capabilities granted when declared, writes ask. */
export function defaultPolicy(): MalleablePolicy {
  const capabilities: Record<Capability, CapabilityRule> = {
    'replay:read': 'allow',
    'comments:read': 'allow',
    'comments:write': 'ask',
    'playback:seek': 'allow',
    notify: 'allow',
    'export:download': 'ask',
  };
  return {
    scopes: ['user'],
    capabilities,
    lockedSurfaces: [],
    workspaceRoles: ['admin'],
    deny: [],
    watchdog: { heartbeatTimeoutMs: 3000, frameBudgetMs: 300000, maxCallsPerSecond: 100 },
  };
}

/** What the viewer assumes when it cannot read the host's policy: nothing is written. */
export function closedPolicy(): MalleablePolicy {
  const policy = defaultPolicy();
  for (const name of Object.keys(policy.capabilities).filter(isCapability)) if (isWriteCapability(name)) policy.capabilities[name] = 'deny';
  return policy;
}

const NAME = '[a-z][a-z0-9-]{0,39}';
const LOCAL = '[a-z][a-z0-9-]{0,31}';
/**
 * A surface id. Built-in inspector tabs are `inspector:<tab>` (`inspector:console`, `inspector:context`, …); a host plugin's
 * contributions are `inspector:<plugin>:<tab>`, `panel:<plugin>:<id>` and `action:<plugin>:<id>`. A user plugin's own
 * surfaces (`user:<id>`) cannot be locked: a user plugin only ever owns them.
 */
export const SURFACE_ID = new RegExp(`^(inspector:${LOCAL}|inspector:${NAME}:${LOCAL}|panel:${NAME}:${LOCAL}|action:${NAME}:${LOCAL})$`);

/** The surface id of something in the viewer registry (src/client/plugins/registry.ts). */
export function surfaceId(kind: 'tabs' | 'panels' | 'actions', plugin: string, id: string) {
  const names = { tabs: 'inspector', panels: 'panel', actions: 'action' };
  return `${names[kind]}:${plugin}:${id}`;
}

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyError';
  }
}

/** Validates the config's `malleable` block (at start-up: a policy that would widen anything stops the server). */
export function parseMalleablePolicy(input: unknown): MalleablePolicy {
  const policy = defaultPolicy();
  if (input === undefined) return policy;
  if (!isRecord(input)) throw new PolicyError("the config file's malleable must be an object");
  const extra = Object.keys(input).find(
    (key) => !['enabled', 'scopes', 'capabilities', 'lockedSurfaces', 'workspaceRoles', 'allow', 'deny', 'watchdog'].includes(key),
  );
  if (extra) throw new PolicyError(`malleable.${extra} is not a supported key (enabled, scopes, capabilities, lockedSurfaces)`);
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new PolicyError('malleable.enabled must be true or false');
  if (input.scopes !== undefined) policy.scopes = parseScopes(input.scopes);
  if (input.capabilities !== undefined) policy.capabilities = { ...policy.capabilities, ...parseCapabilities(input.capabilities) };
  if (input.lockedSurfaces !== undefined) policy.lockedSurfaces = parseLocks(input.lockedSurfaces);
  for (const key of ['workspaceRoles', 'allow', 'deny'] as const)
    if (input[key] !== undefined) policy[key] = parseSelectors(input[key], key);
  if (input.watchdog !== undefined) policy.watchdog = { ...policy.watchdog, ...parseWatchdog(input.watchdog) };

  return policy;
}

function parseScopes(input: unknown): PluginScope[] {
  if (!Array.isArray(input) || !input.every(isScope) || new Set(input).size !== input.length)
    throw new PolicyError('malleable.scopes must list "user" and/or "workspace", each at most once');
  return (['user', 'workspace'] as const).filter((scope) => input.includes(scope));
}
function parseCapabilities(input: unknown): Partial<MalleablePolicy['capabilities']> {
  if (!isRecord(input)) throw new PolicyError('malleable.capabilities must be an object of capability → "allow" | "ask" | "deny"');
  const values: Partial<MalleablePolicy['capabilities']> = {};
  for (const [name, rule] of Object.entries(input)) {
    if (!isCapability(name))
      throw new PolicyError(`malleable.capabilities.${name} is not a capability (${Object.keys(CAPABILITIES).join(', ')})`);
    if (rule !== 'allow' && rule !== 'ask' && rule !== 'deny')
      throw new PolicyError(`malleable.capabilities['${name}'] must be "allow", "ask" or "deny"`);
    if (isWriteCapability(name) && rule === 'allow')
      throw new PolicyError(
        `malleable.capabilities['${name}'] can be "ask" or "deny", not "allow": a write capability always asks the person first`,
      );
    values[name] = rule;
  }
  return values;
}
function parseLocks(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > 200) throw new PolicyError('malleable.lockedSurfaces must be a list of surface ids');
  const locks: string[] = [];
  for (const surface of input) {
    if (
      typeof surface !== 'string' ||
      (!SURFACE_ID.test(surface) && !/^[a-z][a-z0-9.-]*\/(core:[a-z][a-z0-9-]*|plugin:[a-z][a-z0-9-]*:[a-z][a-z0-9-]*)$/.test(surface))
    )
      throw new PolicyError(
        `malleable.lockedSurfaces: ${JSON.stringify(surface)} is not a surface id (inspector:<tab>, inspector:<plugin>:<tab>, panel:<plugin>:<id>, action:<plugin>:<id>)`,
      );
    locks.push(surface);
  }
  return [...new Set(locks)];
}
function parseSelectors(input: unknown, key: 'workspaceRoles' | 'allow' | 'deny'): string[] {
  const pattern = key === 'workspaceRoles' ? /^[a-zA-Z][a-zA-Z0-9:_-]{0,79}$/ : /^(id:[a-z][a-z0-9-]{0,31}|sha256:[a-f0-9]{64})$/;
  const message = `malleable.${key} must be a list of unique ${key === 'workspaceRoles' ? 'role names' : 'id:<id> or sha256:<hash> selectors'}`;
  if (!Array.isArray(input) || input.length > 200) throw new PolicyError(message);
  const values: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string' || !pattern.test(item)) throw new PolicyError(message);
    values.push(item);
  }
  if (new Set(values).size !== values.length) throw new PolicyError(message);
  return values;
}
function parseWatchdog(input: unknown): Partial<MalleablePolicy['watchdog']> {
  if (!isRecord(input)) throw new PolicyError('malleable.watchdog must be an object');
  const limits = { heartbeatTimeoutMs: [1000, 30000], frameBudgetMs: [1000, 3600000], maxCallsPerSecond: [1, 1000] } as const;
  const values: Partial<MalleablePolicy['watchdog']> = {};
  for (const [key, number] of Object.entries(input)) {
    if (key !== 'heartbeatTimeoutMs' && key !== 'frameBudgetMs' && key !== 'maxCallsPerSecond')
      throw new PolicyError(`malleable.watchdog.${key} is outside its allowed integer range`);
    const range = limits[key];
    if (typeof number !== 'number' || !Number.isInteger(number) || number < range[0] || number > range[1])
      throw new PolicyError(`malleable.watchdog.${key} is outside its allowed integer range`);
    values[key] = number;
  }
  return values;
}

/** Stable across host upgrades: targets are deployment metadata, not author-authored code. */
export async function pluginPolicyHash(manifest: UserPluginManifest, source: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([authoredManifest(manifest), source]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function pluginAdmissionProblems(policy: MalleablePolicy, id: string, hash: string): string[] {
  const matches = (selector: string) => selector === `id:${id}` || selector === `sha256:${hash}`;
  if ((policy.deny ?? []).some(matches)) return ['plugin blocked by malleable.deny'];
  if (policy.allow !== undefined && !policy.allow.some(matches)) return ['plugin is not admitted by malleable.allow'];
  return [];
}

export const mayWriteWorkspace = (policy: MalleablePolicy, identity: { roles?: readonly string[] }) =>
  (policy.workspaceRoles ?? ['admin']).some((role) => identity.roles?.includes(role));

export const capabilityRule = (policy: MalleablePolicy, capability: Capability): CapabilityRule =>
  policy.capabilities[capability] ?? (isWriteCapability(capability) ? 'ask' : 'allow');

/** Why the host would not keep this plugin in this scope (empty: it may be kept). */
export function policyProblems(policy: MalleablePolicy, manifest: Pick<UserPluginManifest, 'permissions'>, scope: PluginScope): string[] {
  const problems: string[] = [];
  if (!policy.scopes.includes(scope))
    problems.push(`this server does not keep ${scope === 'user' ? 'personal' : 'workspace'} plugins (malleable.scopes)`);
  const denied = manifest.permissions.filter((capability) => capabilityRule(policy, capability) === 'deny');
  if (denied.length) problems.push(`this server does not allow ${denied.join(', ')} (malleable.capabilities)`);
  return problems;
}

/**
 * Every slot configuration passes this gate. User plugins retain their own namespace; host configuration can reorder
 * or hide registered items and the built-ins supplied by the owning view.
 */
export function assertMayOverride(policy: MalleablePolicy, surface: string) {
  if (policy.lockedSurfaces.includes(surface))
    throw new PolicyError(`permission-denied: ${surface} is locked by the host (malleable.lockedSurfaces)`);
}

/** The core package and the distribution a viewer runs: what a kept plugin version records as its `targets`. */
export interface HostVersions {
  core: string;
  distribution?: { name: string; version: string };
}

export const targetsFor = (versions: HostVersions) => ({
  core: versions.core,
  ...(versions.distribution ? { distribution: `${versions.distribution.name}@${versions.distribution.version}` } : {}),
});

/** One string per (core, distribution) pair: the key load health is recorded under. */
export const versionsKey = (versions: HostVersions) => {
  const targets = targetsFor(versions);
  return targets.distribution ? `${targets.core} ${targets.distribution}` : targets.core;
};

/** Validates the config's `distribution: { name, version }` (the deployment built on this package, e.g. `acme-replays@2.3.0`). */
export function parseDistribution(input: unknown): HostVersions['distribution'] {
  if (input === undefined) return undefined;
  if (!isRecord(input)) throw new PolicyError("the config file's distribution must be { name, version }");
  const value = input;
  const extra = Object.keys(value).find((key) => key !== 'name' && key !== 'version');
  if (extra) throw new PolicyError(`distribution.${extra} is not a supported key (name, version)`);
  if (typeof value.name !== 'string' || !/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]{0,79}$/i.test(value.name))
    throw new PolicyError('distribution.name must be a package-like name (letters, digits, . _ -, optionally @scope/)');
  if (typeof value.version !== 'string' || !/^[\w.+-]{1,40}$/.test(value.version))
    throw new PolicyError('distribution.version must be 1-40 characters of letters, digits, . + - _');
  return { name: value.name, version: value.version };
}
