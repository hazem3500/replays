import { parsePluginSettings, type PluginSettingDefinition } from './plugin-settings.ts';
/**
 * User plugins (beta.malleable): small programs a user or an agent writes for the running viewer. A plugin is one
 * manifest (what it contributes and which capabilities it asks for) plus one JavaScript source. It runs in a sandboxed
 * frame (src/client/malleable/), never in the page. The shareable file format is `*.replays-plugin.json`
 * (docs/formats/user-plugin.schema.json); the stored history is `user-plugin-history.schema.json`.
 */

export const USER_PLUGIN_FORMAT = 'replays-user-plugin/1';
export const USER_PLUGIN_HISTORY_FORMAT = 'replays-user-plugin-history/1';

export const PLUGIN_ID = /^[a-z][a-z0-9-]{0,31}$/;
export const CONTRIBUTION_ID = /^[a-z][a-z0-9-]{0,31}$/;
/** Largest plugin source, in characters. */
export const MAX_SOURCE = 64 * 1024;
/** Most versions kept per plugin; the oldest are dropped past this. */
export const MAX_VERSIONS = 100;
export const MAX_CONTRIBUTIONS = 8;

/**
 * Capabilities a plugin can ask for in `permissions`. `read-only` ones are granted when declared; `write` ones are also
 * declared, and additionally need the person's yes in a prompt that shows the exact thing about to happen (per page
 * load; nothing is remembered).
 */
export const CAPABILITIES = {
  'replay:read': { tier: 'read-only', label: 'Read the open replay (metadata, steps, console, network, context)' },
  'playback:seek': { tier: 'read-only', label: 'Move the playhead' },
  'comments:read': { tier: 'read-only', label: 'Read the replay’s comments' },
  notify: { tier: 'read-only', label: 'Show a short message' },
  'comments:write': { tier: 'write', label: 'Add comments to the replay' },
  'export:download': { tier: 'write', label: 'Download a file to your computer' },
} as const;
export type Capability = keyof typeof CAPABILITIES;
export const isCapability = (value: unknown): value is Capability => typeof value === 'string' && value in CAPABILITIES;
export const isWriteCapability = (capability: Capability) => CAPABILITIES[capability].tier === 'write';

export interface Contribution {
  id: string;
  label: string;
}

export interface UserPluginManifest {
  format: typeof USER_PLUGIN_FORMAT;
  id: string;
  name: string;
  description?: string;
  permissions: Capability[];
  settings?: PluginSettingDefinition[];
  contributes: {
    /** Inspector tabs (bottom panel, next to Console and Network). */
    tabs?: Contribution[];
    contextSections?: Contribution[];
    tracks?: Contribution[];
    /** Side drawer panels, opened from the More menu. */
    panels?: Contribution[];
    /** Entries in the More menu that run the plugin's function once. */
    actions?: Contribution[];
  };
  /**
   * The versions this plugin was last kept under: the core package and, when the deployment names one, its distribution
   * (`name@version`). Written by the server when a version is saved (whatever the client sent); used by the viewer to tell
   * "this plugin broke after an upgrade" from "this plugin is broken" (docs/malleability.md#upgrades).
   */
  targets?: PluginTargets;
}

export interface PluginTargets {
  core: string;
  distribution?: string;
}

export type PluginScope = 'user' | 'workspace';
export const isScope = (value: unknown): value is PluginScope => value === 'user' || value === 'workspace';

/** The shareable file: `{ manifest, source }`, with the history when exported "with versions". */
export interface UserPluginFile {
  format: typeof USER_PLUGIN_FORMAT;
  manifest: UserPluginManifest;
  source: string;
  versions?: PluginVersion[];
}

export interface PluginVersion {
  n: number;
  at: string;
  /** Display name of who approved it. */
  by: string;
  message: string;
  manifest: UserPluginManifest;
  source: string;
  /** sha256 hex of the canonical manifest + source. */
  sha256: string;
}

export interface PluginHistory {
  format: typeof USER_PLUGIN_HISTORY_FORMAT;
  id: string;
  versions: PluginVersion[];
}

/** `GET /api/malleable/plugins`. */
export interface PluginSummary {
  id: string;
  scope: PluginScope;
  name: string;
  version: number;
  updatedAt: string;
  by: string;
  /** Per-person notice for a new workspace version; it must be accepted before loading. */
  requiresReview?: boolean;
  sha256?: string;
}

export class PluginFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginFormatError';
  }
}

function contributions(value: unknown, kind: string): Contribution[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_CONTRIBUTIONS)
    throw new PluginFormatError(`contributes.${kind} must be a list of at most ${MAX_CONTRIBUTIONS}`);
  const seen = new Set<string>();
  return value.map((item, index) => {
    const entry = item as Partial<Contribution> | null;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new PluginFormatError(`contributes.${kind}[${index}] must be an object`);
    const extra = Object.keys(entry).find((key) => key !== 'id' && key !== 'label');
    if (extra) throw new PluginFormatError(`contributes.${kind}[${index}].${extra} is not a supported field`);
    if (typeof entry.id !== 'string' || !CONTRIBUTION_ID.test(entry.id))
      throw new PluginFormatError(`contributes.${kind}[${index}].id must match ${CONTRIBUTION_ID}`);
    if (typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > 40)
      throw new PluginFormatError(`contributes.${kind}[${index}].label must be 1-40 characters`);
    if (seen.has(entry.id)) throw new PluginFormatError(`contributes.${kind} lists "${entry.id}" twice`);
    seen.add(entry.id);
    return { id: entry.id, label: entry.label.trim() };
  });
}

/** Validates and normalises a manifest from any source (a file, the editor, an agent). Throws PluginFormatError. */
export function parseManifest(value: unknown): UserPluginManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PluginFormatError('the manifest must be an object');
  const input = value as Record<string, unknown>;
  const known = ['format', 'id', 'name', 'description', 'permissions', 'contributes', 'targets', 'settings'];
  const extra = Object.keys(input).find((key) => !known.includes(key));
  if (extra) throw new PluginFormatError(`manifest.${extra} is not a supported field`);
  if (input.format !== USER_PLUGIN_FORMAT) throw new PluginFormatError(`manifest.format must be "${USER_PLUGIN_FORMAT}"`);
  if (typeof input.id !== 'string' || !PLUGIN_ID.test(input.id)) throw new PluginFormatError(`manifest.id must match ${PLUGIN_ID}`);
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 60)
    throw new PluginFormatError('manifest.name must be 1-60 characters');
  if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 300))
    throw new PluginFormatError('manifest.description must be at most 300 characters');
  const permissions = input.permissions ?? [];
  if (!Array.isArray(permissions) || !permissions.every(isCapability))
    throw new PluginFormatError(`manifest.permissions must be a list of: ${Object.keys(CAPABILITIES).join(', ')}`);
  const contributesInput = input.contributes;
  if (!contributesInput || typeof contributesInput !== 'object' || Array.isArray(contributesInput))
    throw new PluginFormatError('manifest.contributes must be an object');
  const c = contributesInput as Record<string, unknown>;
  const extraKey = Object.keys(c).find((key) => !['tabs', 'panels', 'actions', 'contextSections', 'tracks'].includes(key));
  if (extraKey) throw new PluginFormatError(`manifest.contributes.${extraKey} is not a supported field`);
  const tabs = contributions(c.tabs, 'tabs');
  const panels = contributions(c.panels, 'panels');
  const actions = contributions(c.actions, 'actions');
  const contextSections = contributions(c.contextSections, 'contextSections');
  const tracks = contributions(c.tracks, 'tracks');
  if (!tabs?.length && !panels?.length && !actions?.length && !contextSections?.length && !tracks?.length)
    throw new PluginFormatError('a plugin must contribute at least one viewer contribution');
  const targets = parseTargets(input.targets);
  let settings: PluginSettingDefinition[] | undefined;
  try {
    settings = input.settings === undefined ? undefined : parsePluginSettings(input.settings);
  } catch (error) {
    throw new PluginFormatError(`manifest.settings: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    format: USER_PLUGIN_FORMAT,
    id: input.id,
    name: input.name.trim(),
    ...(input.description ? { description: input.description as string } : {}),
    permissions: [...new Set(permissions as Capability[])],
    contributes: {
      ...(contextSections?.length ? { contextSections } : {}),
      ...(tracks?.length ? { tracks } : {}),
      ...(tabs?.length ? { tabs } : {}),
      ...(panels?.length ? { panels } : {}),
      ...(actions?.length ? { actions } : {}),
    },
    ...(targets ? { targets } : {}),
    ...(settings ? { settings } : {}),
  };
}

function parseTargets(value: unknown): PluginTargets | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PluginFormatError('manifest.targets must be an object');
  const input = value as Record<string, unknown>;
  const extra = Object.keys(input).find((key) => key !== 'core' && key !== 'distribution');
  if (extra) throw new PluginFormatError(`manifest.targets.${extra} is not a supported field`);
  if (typeof input.core !== 'string' || !input.core || input.core.length > 40)
    throw new PluginFormatError('manifest.targets.core must be a version string');
  if (
    input.distribution !== undefined &&
    (typeof input.distribution !== 'string' || !input.distribution || input.distribution.length > 130)
  )
    throw new PluginFormatError('manifest.targets.distribution must be "name@version"');
  return { core: input.core, ...(input.distribution ? { distribution: input.distribution as string } : {}) };
}

/** The manifest without `targets`: what the author wrote, for comparing a working copy with a saved version. */
export function authoredManifest(manifest: UserPluginManifest): Omit<UserPluginManifest, 'targets'> {
  const { targets: _targets, ...rest } = manifest;
  return rest;
}

export function parseSource(value: unknown): string {
  if (typeof value !== 'string') throw new PluginFormatError('source must be a string');
  if (!value.trim()) throw new PluginFormatError('source is empty');
  if (value.length > MAX_SOURCE) throw new PluginFormatError(`source is longer than ${MAX_SOURCE} characters`);
  return value;
}

/** A `.replays-plugin.json` file's content (already JSON.parsed). */
export function parsePluginFile(value: unknown): UserPluginFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PluginFormatError('a plugin file is a JSON object');
  const input = value as Record<string, unknown>;
  const extra = Object.keys(input).find((key) => !['format', 'manifest', 'source', 'versions'].includes(key));
  if (extra) throw new PluginFormatError(`${extra} is not a supported field`);
  if (input.format !== USER_PLUGIN_FORMAT) throw new PluginFormatError(`format must be "${USER_PLUGIN_FORMAT}"`);
  const manifest = parseManifest(input.manifest);
  const source = parseSource(input.source);
  if (input.versions !== undefined && !Array.isArray(input.versions)) throw new PluginFormatError('versions must be a list');
  return { format: USER_PLUGIN_FORMAT, manifest, source, ...(input.versions ? { versions: input.versions as PluginVersion[] } : {}) };
}

export function pluginFile(manifest: UserPluginManifest, source: string, versions?: PluginVersion[]): UserPluginFile {
  return { format: USER_PLUGIN_FORMAT, manifest, source, ...(versions ? { versions } : {}) };
}

/** A starting point: the smallest plugin that shows something, for "New plugin" in the editor. */
export function starterPlugin(id = 'my-tab'): { manifest: UserPluginManifest; source: string } {
  return {
    manifest: {
      format: USER_PLUGIN_FORMAT,
      id,
      name: 'My tab',
      description: 'Counts requests by status.',
      permissions: ['replay:read'],
      contributes: { tabs: [{ id: 'main', label: 'My tab' }] },
    },
    source: `// Runs in a sandbox. \`replays\` is the only way out: see docs/malleability.md for the API.
replays.tab('main', (el, ctx) => {
  const counts = {};
  for (const r of ctx.replay.network) counts[r.status] = (counts[r.status] || 0) + 1;
  el.innerHTML = '<h3>Requests by status</h3>';
  const list = document.createElement('ul');
  for (const [status, n] of Object.entries(counts)) {
    const li = document.createElement('li');
    li.textContent = status + ': ' + n;
    list.append(li);
  }
  el.append(list);
});
`,
  };
}
