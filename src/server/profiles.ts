import type { Owned } from '../plugin/registry.ts';
import type { ProfileDefinition, ProfileInferInput, RetentionRuleDefinition } from '../plugin/types.ts';
import {
  assertProfileConfig,
  BUILT_IN_PROFILES,
  legacyProfileRetentionEnv,
  type PosterMoment,
  type ProfileConfig,
  type ProfileInfo,
  profileProblem,
  profileRetentionEnv,
} from '../shared/profiles.ts';
import { profileOfSummary, summaryProfile, withoutProfile, type ReplaySummary } from '../shared/replay.ts';
import { daysFromEnv, type RetentionRule } from '../shared/retention.ts';

/** One profile as the server uses it: the public part, plus who declared it and how to infer it. */
export interface ResolvedProfile {
  info: ProfileInfo;
  infer?: (input: ProfileInferInput) => boolean;
  /** The plugin that registered it; absent for config-only profiles. */
  plugin?: string;
}

/**
 * The deployment's profiles, merged from the config file (`profiles`) and plugins (`api.profile`): validated,
 * ordered, with environment overrides of their retention. Empty in a plain core: then nothing about profiles
 * shows anywhere, and an upload that names one is refused.
 */
export class ProfileCatalog {
  readonly list: readonly ProfileInfo[];
  private readonly byId: ReadonlyMap<string, ResolvedProfile>;
  private readonly inferrers: readonly ResolvedProfile[];
  private readonly failed = new Set<string>();
  private readonly log: (line: string) => void;

  constructor(profiles: readonly ResolvedProfile[] = [], log: (line: string) => void = (line) => console.error(line)) {
    this.byId = new Map(profiles.map((profile) => [profile.info.id, profile]));
    this.list = profiles.map((profile) => profile.info);
    this.inferrers = profiles.filter((profile) => profile.infer);
    this.log = log;
  }

  get size() {
    return this.list.length;
  }

  get ids() {
    return this.list.map((profile) => profile.id);
  }

  has(id: string | undefined) {
    return id !== undefined && this.byId.has(id);
  }

  get(id: string | undefined) {
    return id === undefined ? undefined : this.byId.get(id)?.info;
  }

  /** Why `profile` (an upload's `meta.profile`) is refused, or undefined. */
  problem(profile: unknown) {
    return profileProblem(profile, this.ids);
  }

  /** Whole days per profile that has its own window. */
  retentionDays(): Record<string, number> {
    return Object.fromEntries(
      this.list.flatMap((profile) => (profile.retentionDays === undefined ? [] : [[profile.id, profile.retentionDays]])),
    );
  }

  /** The poster moment for a replay of `profile` (undefined: the default, middle-step). */
  poster(profile: string | undefined): PosterMoment | undefined {
    return this.get(profile)?.poster;
  }

  /**
   * The summary with its profile: the explicit one as stored, else the first profile (in order) whose `infer`
   * says yes. A throwing `infer` counts as no and is logged once. Sidecars written before the rename carry only
   * `purpose`; they read the same.
   */
  apply(summary: ReplaySummary): ReplaySummary {
    const own = profileOfSummary(summary);
    const rest = withoutProfile(summary);
    if (own.id && !own.inferred) return { ...rest, ...summaryProfile(own.id, false) };
    if (!this.inferrers.length) return rest;
    const input: ProfileInferInput = { ...rest, errors: rest.consoleErrors + rest.failedRequests };
    for (const candidate of this.inferrers) {
      let match = false;
      try {
        const answer: unknown = candidate.infer?.(input);
        match = answer === true;
      } catch (error) {
        if (!this.failed.has(candidate.info.id)) {
          this.failed.add(candidate.info.id);
          this.log(
            `plugin ${candidate.plugin}: profile ${candidate.info.id}: infer failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (match) return { ...rest, ...summaryProfile(candidate.info.id, true) };
    }
    return rest;
  }
}

/** An `api.retention` rule that never throws: errors and bad values are logged once and count as "no limit". */
export function wrapRetentionRules(
  rules: readonly Owned<RetentionRuleDefinition>[],
  log: (line: string) => void = (line) => console.error(line),
) {
  return rules.map(({ plugin, value }): RetentionRule => {
    let reported = false;
    const report = (message: string) => {
      if (reported) return;
      reported = true;
      log(`plugin ${plugin}: retention: ${message}`);
    };
    return (summary) => {
      try {
        const days = value.days(summary);
        if (days === undefined || days === null) return;
        if (typeof days !== 'number' || !Number.isInteger(days) || days < 0) {
          report(`days() must return a whole number of days, 0 or undefined (got ${JSON.stringify(days)})`);
          return;
        }
        return days;
      } catch (error) {
        report(`days() failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
  });
}

/** Throws unless the config file's `profiles` (or its deprecated `purposes`) is a list of well-formed profiles with distinct ids. */
export function assertConfigProfiles(value: unknown, key = 'profiles'): asserts value is ProfileConfig[] {
  if (!Array.isArray(value)) throw new Error(`the config file's ${key} must be an array of { id, label, … }`);
  const seen = new Set<string>();
  for (const [index, profile] of value.entries()) {
    assertProfileConfig(profile, `${key}[${index}]`);
    if (seen.has(profile.id)) throw new Error(`${key}[${index}]: ${JSON.stringify(profile.id)} is declared twice`);
    seen.add(profile.id);
  }
}

/**
 * The config file's profiles: `profiles`, else the deprecated `purposes` (reported through `warn`). Both at once
 * is refused, so a half-migrated config never silently drops entries.
 */
export function configProfiles(
  file: { profiles?: readonly ProfileConfig[] | undefined; purposes?: readonly ProfileConfig[] | undefined },
  warn?: (line: string) => void,
): readonly ProfileConfig[] | undefined {
  if (file.purposes === undefined) return file.profiles;
  if (file.profiles !== undefined)
    throw new Error('the config file sets both profiles and purposes: keep profiles (purposes is its deprecated name)');
  assertConfigProfiles(file.purposes, 'purposes');
  warn?.("warning: the config file's purposes key is deprecated; rename it to profiles");
  return file.purposes;
}

const RETENTION_PROFILE_ENV = /^RETENTION_(PROFILE|PURPOSE)_[A-Z0-9_]+_DAYS$/;

/** Core's built-in profiles: under a deployment entry with the same id (its fields win), else added as they are. */
function addBuiltIns(merged: MergedProfile[]) {
  for (const builtIn of BUILT_IN_PROFILES) {
    const own = merged.find((entry) => entry.declared.id === builtIn.id);
    if (own) own.declared = { ...builtIn, ...own.declared };
    else merged.push({ declared: builtIn, builtIn: true });
  }
}

/** Retention variables naming no profile, and the deprecated spelling, each get one warning. */
function warnRetentionEnv(env: Record<string, string | undefined>, resolved: readonly ResolvedProfile[], log: (line: string) => void) {
  const known = new Set(resolved.flatMap((profile) => [profileRetentionEnv(profile.info.id), legacyProfileRetentionEnv(profile.info.id)]));
  for (const name of Object.keys(env)) {
    if (!RETENTION_PROFILE_ENV.test(name)) continue;
    if (!known.has(name)) log(`warning: ${name} is set, but no profile has that id; it is ignored`);
    else if (name.startsWith('RETENTION_PURPOSE_'))
      log(`warning: ${name} is deprecated; rename it to ${name.replace('RETENTION_PURPOSE_', 'RETENTION_PROFILE_')}`);
  }
}

/** A profile after the config, plugin and built-in declarations of its id are merged. */
interface MergedProfile {
  declared: ProfileConfig;
  infer?: (input: ProfileInferInput) => boolean;
  plugin?: string;
  builtIn?: true;
}

/** The public part of a merged profile, with its retention window from the environment, plus how to infer it. */
function resolveProfile(profile: MergedProfile, env: Record<string, string | undefined>): ResolvedProfile {
  const { declared } = profile;
  const days =
    daysFromEnv(env, profileRetentionEnv(declared.id)) ??
    daysFromEnv(env, legacyProfileRetentionEnv(declared.id)) ??
    declared.retentionDays;
  const info: ProfileInfo = {
    id: declared.id,
    label: declared.label.trim(),
    order: declared.order ?? 0,
    ...(days === undefined ? {} : { retentionDays: days }),
    ...(declared.viewer && Object.keys(declared.viewer).length ? { viewer: declared.viewer } : {}),
    ...(declared.poster ? { poster: declared.poster } : {}),
    ...(declared.view ? { view: declared.view } : {}),
    ...(declared.capture ? { capture: declared.capture } : {}),
    ...(profile.infer ? { inferable: true } : {}),
    ...(profile.builtIn ? { builtIn: true as const } : {}),
  };
  return { info, ...(profile.infer ? { infer: profile.infer } : {}), ...(profile.plugin ? { plugin: profile.plugin } : {}) };
}

/**
 * Merges the config's profiles with the plugins': config entries come first (in file order) and override the
 * fields of a plugin profile with the same id (its `infer` is kept); then plugin-only profiles in plugin order;
 * then everything is sorted by `order` (stable). `RETENTION_PROFILE_<ID>_DAYS` (or the deprecated
 * `RETENTION_PURPOSE_<ID>_DAYS`) overrides a profile's window.
 */
export function createProfileCatalog(options: {
  config?: readonly ProfileConfig[] | undefined;
  plugins?: readonly Owned<ProfileDefinition>[];
  env?: Record<string, string | undefined>;
  /** Warnings (an override for an unknown profile) and `infer` failures go here; without it, no warnings and failures to stderr. */
  log?: (line: string) => void;
  /** Include core's BUILT_IN_PROFILES (default true); tests of the merge rules turn it off. */
  builtIns?: boolean;
}): ProfileCatalog {
  const env = options.env ?? {};
  const log = options.log;
  const config = options.config ?? [];
  assertConfigProfiles(config);
  const plugins = options.plugins ?? [];
  const merged: MergedProfile[] = [];
  const add = (declared: ProfileConfig, plugin?: Owned<ProfileDefinition>) =>
    merged.push({
      declared,
      ...(plugin?.value.infer ? { infer: plugin.value.infer.bind(plugin.value) } : {}),
      ...(plugin ? { plugin: plugin.plugin } : {}),
    });
  for (const entry of config) {
    const plugin = plugins.find((candidate) => candidate.value.id === entry.id);
    if (!plugin) add(entry);
    else {
      const viewer = plugin.value.viewer || entry.viewer ? { viewer: { ...plugin.value.viewer, ...entry.viewer } } : {};
      add({ ...strip(plugin.value), ...entry, ...viewer }, plugin);
    }
  }
  for (const plugin of plugins) if (!config.some((entry) => entry.id === plugin.value.id)) add(strip(plugin.value), plugin);
  if (options.builtIns !== false) addBuiltIns(merged);
  const resolved = merged
    .map((profile, index) => ({ profile, index }))
    .sort((a, b) => (a.profile.declared.order ?? 0) - (b.profile.declared.order ?? 0) || a.index - b.index)
    .map(({ profile }) => resolveProfile(profile, env));
  // why: only the server's final catalog has `log`; a partial one (the config's alone) would flag the plugins' variables.
  if (log) warnRetentionEnv(env, resolved, log);
  return new ProfileCatalog(resolved, log);
}

/** The definition without `infer`, field by field: destructuring the method out would leave it unbound. */
function strip({ id, label, order, retentionDays, viewer, poster, view, capture }: ProfileDefinition): ProfileConfig {
  return {
    id,
    label,
    ...(order === undefined ? {} : { order }),
    ...(retentionDays === undefined ? {} : { retentionDays }),
    ...(viewer === undefined ? {} : { viewer }),
    ...(poster === undefined ? {} : { poster }),
    ...(view === undefined ? {} : { view }),
    ...(capture === undefined ? {} : { capture }),
  };
}
