import type { Owned } from '../plugin/registry.ts';
import type { PurposeDefinition, PurposeInferInput, RetentionRuleDefinition } from '../plugin/types.ts';
import {
  assertPurposeConfig,
  type PosterMoment,
  type PurposeConfig,
  type PurposeInfo,
  purposeProblem,
  purposeRetentionEnv,
} from '../shared/purposes.ts';
import type { ReplaySummary } from '../shared/replay.ts';
import { daysFromEnv, type RetentionRule } from '../shared/retention.ts';

/** One purpose as the server uses it: the public part, plus who declared it and how to infer it. */
export interface ResolvedPurpose {
  info: PurposeInfo;
  infer?: (input: PurposeInferInput) => boolean;
  /** The plugin that registered it; absent for config-only purposes. */
  plugin?: string;
}

/**
 * The deployment's purposes, merged from the config file (`purposes`) and plugins (`api.purpose`): validated,
 * ordered, with environment overrides of their retention. Empty in a plain core: then nothing about purposes
 * shows anywhere, and an upload that names one is refused.
 */
export class PurposeCatalog {
  readonly list: readonly PurposeInfo[];
  private readonly byId: ReadonlyMap<string, ResolvedPurpose>;
  private readonly inferrers: readonly ResolvedPurpose[];
  private readonly failed = new Set<string>();
  private readonly log: (line: string) => void;

  constructor(purposes: readonly ResolvedPurpose[] = [], log: (line: string) => void = (line) => console.error(line)) {
    this.byId = new Map(purposes.map((purpose) => [purpose.info.id, purpose]));
    this.list = purposes.map((purpose) => purpose.info);
    this.inferrers = purposes.filter((purpose) => purpose.infer);
    this.log = log;
  }

  get size() {
    return this.list.length;
  }

  get ids() {
    return this.list.map((purpose) => purpose.id);
  }

  has(id: string | undefined) {
    return id !== undefined && this.byId.has(id);
  }

  get(id: string | undefined) {
    return id === undefined ? undefined : this.byId.get(id)?.info;
  }

  /** Why `purpose` (an upload's `meta.purpose`) is refused, or undefined. */
  problem(purpose: unknown) {
    return purposeProblem(purpose, this.ids);
  }

  /** Whole days per purpose that has its own window. */
  retentionDays(): Record<string, number> {
    return Object.fromEntries(this.list.flatMap((purpose) => (purpose.retentionDays === undefined ? [] : [[purpose.id, purpose.retentionDays]])));
  }

  /** The poster moment for a replay of `purpose` (undefined: the default, middle-step). */
  poster(purpose: string | undefined): PosterMoment | undefined {
    return this.get(purpose)?.poster;
  }

  /**
   * The summary with its purpose: the explicit one as stored, else the first purpose (in order) whose `infer`
   * says yes. A throwing `infer` counts as no and is logged once.
   */
  apply(summary: ReplaySummary): ReplaySummary {
    if (summary.purpose && !summary.purposeInferred) return summary;
    const { purpose: _purpose, purposeInferred: _inferred, ...rest } = summary;
    if (!this.inferrers.length) return rest;
    const input: PurposeInferInput = { ...rest, errors: rest.consoleErrors + rest.failedRequests };
    for (const candidate of this.inferrers) {
      let match = false;
      try {
        match = candidate.infer!(input) === true;
      } catch (error) {
        if (!this.failed.has(candidate.info.id)) {
          this.failed.add(candidate.info.id);
          this.log(`plugin ${candidate.plugin}: purpose ${candidate.info.id}: infer failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (match) return { ...rest, purpose: candidate.info.id, purposeInferred: true };
    }
    return rest;
  }
}

/** An `api.retention` rule that never throws: errors and bad values are logged once and count as "no limit". */
export function wrapRetentionRules(rules: readonly Owned<RetentionRuleDefinition>[], log: (line: string) => void = (line) => console.error(line)) {
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
        if (days === undefined || days === null) return undefined;
        if (typeof days !== 'number' || !Number.isInteger(days) || days < 0) {
          report(`days() must return a whole number of days, 0 or undefined (got ${JSON.stringify(days)})`);
          return undefined;
        }
        return days;
      } catch (error) {
        report(`days() failed: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      }
    };
  });
}

/** Throws unless the config file's `purposes` is a list of well-formed purposes with distinct ids. */
export function assertConfigPurposes(value: unknown): asserts value is PurposeConfig[] {
  if (!Array.isArray(value)) throw new Error("the config file's purposes must be an array of { id, label, … }");
  const seen = new Set<string>();
  value.forEach((purpose, index) => {
    assertPurposeConfig(purpose, `purposes[${index}]`);
    if (seen.has(purpose.id)) throw new Error(`purposes[${index}]: ${JSON.stringify(purpose.id)} is declared twice`);
    seen.add(purpose.id);
  });
}

const RETENTION_PURPOSE_ENV = /^RETENTION_PURPOSE_[A-Z0-9_]+_DAYS$/;

/**
 * Merges the config's purposes with the plugins': config entries come first (in file order) and override the
 * fields of a plugin purpose with the same id (its `infer` is kept); then plugin-only purposes in plugin order;
 * then everything is sorted by `order` (stable). `RETENTION_PURPOSE_<ID>_DAYS` overrides a purpose's window.
 */
export function createPurposeCatalog(options: {
  config?: readonly PurposeConfig[] | undefined;
  plugins?: readonly Owned<PurposeDefinition>[];
  env?: Record<string, string | undefined>;
  /** Warnings (an override for an unknown purpose) and `infer` failures go here; without it, no warnings and failures to stderr. */
  log?: (line: string) => void;
}): PurposeCatalog {
  const env = options.env ?? {};
  const log = options.log;
  const config = options.config ?? [];
  assertConfigPurposes(config);
  const plugins = options.plugins ?? [];
  const merged: Array<{ declared: PurposeConfig; infer?: (input: PurposeInferInput) => boolean; plugin?: string }> = [];
  const add = (declared: PurposeConfig, plugin?: Owned<PurposeDefinition>) =>
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
  const resolved = merged
    .map((purpose, index) => ({ purpose, index }))
    .sort((a, b) => (a.purpose.declared.order ?? 0) - (b.purpose.declared.order ?? 0) || a.index - b.index)
    .map(({ purpose }): ResolvedPurpose => {
      const { declared } = purpose;
      const days = daysFromEnv(env, purposeRetentionEnv(declared.id)) ?? declared.retentionDays;
      const info: PurposeInfo = {
        id: declared.id,
        label: declared.label.trim(),
        order: declared.order ?? 0,
        ...(days === undefined ? {} : { retentionDays: days }),
        ...(declared.viewer && Object.keys(declared.viewer).length ? { viewer: declared.viewer } : {}),
        ...(declared.poster ? { poster: declared.poster } : {}),
        ...(purpose.infer ? { inferable: true } : {}),
      };
      return { info, ...(purpose.infer ? { infer: purpose.infer } : {}), ...(purpose.plugin ? { plugin: purpose.plugin } : {}) };
    });
  // Only with `log` (the server's final catalog): a partial one (the config's alone) would flag the plugins' variables.
  const known = new Set(resolved.map((purpose) => purposeRetentionEnv(purpose.info.id)));
  if (log)
    for (const name of Object.keys(env))
      if (RETENTION_PURPOSE_ENV.test(name) && !known.has(name)) log(`warning: ${name} is set, but no purpose has that id; it is ignored`);
  return new PurposeCatalog(resolved, log);
}

function strip(definition: PurposeDefinition): PurposeConfig {
  const { infer: _infer, ...rest } = definition;
  return rest;
}
