import {
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
 *     scopes: ['user'],                                 where plugins may be kept (default: both)
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
}

/** The `malleable` key of the config file / `defineConfig()`. */
export interface MalleableConfig {
  /** Turns user plugins on, like `beta.malleable` (either may be used; if both are set they must agree). */
  enabled?: boolean;
  scopes?: PluginScope[];
  capabilities?: Partial<Record<Capability, CapabilityRule>>;
  lockedSurfaces?: string[];
}

const RULES: readonly CapabilityRule[] = ['allow', 'ask', 'deny'];

/** What applies with no `malleable` block: both scopes, read-only capabilities granted when declared, writes ask. */
export function defaultPolicy(): MalleablePolicy {
  const capabilities = {} as Record<Capability, CapabilityRule>;
  for (const name of Object.keys(CAPABILITIES) as Capability[]) capabilities[name] = isWriteCapability(name) ? 'ask' : 'allow';
  return { scopes: ['user', 'workspace'], capabilities, lockedSurfaces: [] };
}

/** What the viewer assumes when it cannot read the host's policy: nothing is written. */
export function closedPolicy(): MalleablePolicy {
  const policy = defaultPolicy();
  for (const name of Object.keys(policy.capabilities) as Capability[]) if (isWriteCapability(name)) policy.capabilities[name] = 'deny';
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
  return `${kind === 'tabs' ? 'inspector' : kind === 'panels' ? 'panel' : 'action'}:${plugin}:${id}`;
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
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PolicyError("the config file's malleable must be an object");
  const value = input as Record<string, unknown>;
  const extra = Object.keys(value).find((key) => !['enabled', 'scopes', 'capabilities', 'lockedSurfaces'].includes(key));
  if (extra) throw new PolicyError(`malleable.${extra} is not a supported key (enabled, scopes, capabilities, lockedSurfaces)`);
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new PolicyError('malleable.enabled must be true or false');
  if (value.scopes !== undefined) {
    if (!Array.isArray(value.scopes) || !value.scopes.every(isScope) || new Set(value.scopes).size !== value.scopes.length)
      throw new PolicyError('malleable.scopes must list "user" and/or "workspace", each at most once');
    policy.scopes = (['user', 'workspace'] as const).filter((scope) => (value.scopes as string[]).includes(scope));
  }
  if (value.capabilities !== undefined) {
    if (!value.capabilities || typeof value.capabilities !== 'object' || Array.isArray(value.capabilities))
      throw new PolicyError('malleable.capabilities must be an object of capability → "allow" | "ask" | "deny"');
    for (const [name, rule] of Object.entries(value.capabilities)) {
      if (!isCapability(name))
        throw new PolicyError(`malleable.capabilities.${name} is not a capability (${Object.keys(CAPABILITIES).join(', ')})`);
      if (!RULES.includes(rule as CapabilityRule))
        throw new PolicyError(`malleable.capabilities['${name}'] must be "allow", "ask" or "deny"`);
      if (isWriteCapability(name) && rule === 'allow')
        throw new PolicyError(
          `malleable.capabilities['${name}'] can be "ask" or "deny", not "allow": a write capability always asks the person first`,
        );
      policy.capabilities[name] = rule as CapabilityRule;
    }
  }
  if (value.lockedSurfaces !== undefined) {
    if (!Array.isArray(value.lockedSurfaces) || value.lockedSurfaces.length > 200)
      throw new PolicyError('malleable.lockedSurfaces must be a list of surface ids');
    for (const surface of value.lockedSurfaces)
      if (typeof surface !== 'string' || !SURFACE_ID.test(surface))
        throw new PolicyError(
          `malleable.lockedSurfaces: ${JSON.stringify(surface)} is not a surface id (inspector:<tab>, inspector:<plugin>:<tab>, panel:<plugin>:<id>, action:<plugin>:<id>)`,
        );
    policy.lockedSurfaces = [...new Set(value.lockedSurfaces as string[])];
  }
  return policy;
}

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
 * The one check every path that lets a user plugin replace or hide a surface must pass. Today there is no such path: a user
 * plugin can only add tabs, panels and actions under its own `user:<id>` name (the manifest has no `replaces` or `hides`
 * field, and the registry keeps every registration in its owner's namespace), so this guards future override features.
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
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new PolicyError("the config file's distribution must be { name, version }");
  const value = input as Record<string, unknown>;
  const extra = Object.keys(value).find((key) => key !== 'name' && key !== 'version');
  if (extra) throw new PolicyError(`distribution.${extra} is not a supported key (name, version)`);
  if (typeof value.name !== 'string' || !/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]{0,79}$/i.test(value.name))
    throw new PolicyError('distribution.name must be a package-like name (letters, digits, . _ -, optionally @scope/)');
  if (typeof value.version !== 'string' || !/^[\w.+-]{1,40}$/.test(value.version))
    throw new PolicyError('distribution.version must be 1-40 characters of letters, digits, . + - _');
  return { name: value.name, version: value.version };
}
