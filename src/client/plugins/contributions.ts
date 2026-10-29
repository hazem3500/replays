import type { ReplayEdits } from '../../shared/edits.ts';
import type { ReplayBundle } from '../../shared/replay.ts';
import type { ViewerPluginContext } from './api.ts';
import { shortcutFor, type KeyLike } from '../shortcuts.ts';

export interface EditorToolContext {
  readonly replay: Readonly<ReplayBundle>;
  readonly edits: Readonly<ReplayEdits>;
  readonly duration: number;
  getTime(): number;
}

/** The editor validates this synchronous transform and owns undo and saving. */
export interface EditorToolDefinition {
  id: string;
  label: string;
  order?: number;
  when?(context: EditorToolContext): boolean;
  run(context: EditorToolContext): ReplayEdits | void;
}

export interface ReplayExportFile {
  name: string;
  data: string | Blob;
  mime?: string;
}

/** Returning nothing supports a protected server job or an existing download flow. */
export interface ExportFormatDefinition {
  id: string;
  label: string;
  order?: number;
  when?(context: ViewerPluginContext): boolean;
  run(context: ViewerPluginContext): ReplayExportFile | void | Promise<ReplayExportFile | void>;
}

export interface ShortcutDefinition {
  id: string;
  label: string;
  /** Letter keys, optionally prefixed with `Shift+`; core and browser modifier bindings are reserved. */
  keys: readonly string[];
  order?: number;
  when?(context: ViewerPluginContext): boolean;
  run(context: ViewerPluginContext): void | Promise<void>;
}

export function normalizeShortcut(key: string): string {
  const match = /^(Shift\+)?([a-z])$/i.exec(key);
  if (!match?.[2]) throw new TypeError('shortcut keys must be letters, optionally prefixed with Shift+');
  const shiftKey = Boolean(match[1]);
  const letter = match[2].toLowerCase();
  const event: KeyLike = { key: shiftKey ? letter.toUpperCase() : letter, shiftKey, ctrlKey: false, metaKey: false, altKey: false };
  if (shortcutFor(event)) throw new TypeError(`shortcut ${key} is reserved by core`);
  return shiftKey ? `Shift+${letter.toUpperCase()}` : letter;
}

export function contributionOwner(key: string): string {
  return key.startsWith('plugin:') ? key.slice('plugin:'.length, key.lastIndexOf(':')) : '';
}

export function assertHostContribution(
  plugin: string,
  definition: { id: string; label: string; run: unknown; order?: number; when?: unknown },
): void {
  if (typeof plugin !== 'string' || !/^[a-z][a-z0-9-]*$/.test(plugin))
    throw new TypeError('only host plugins may register this contribution');
  if (
    !definition ||
    typeof definition.id !== 'string' ||
    !/^[a-z][a-z0-9-]*$/.test(definition.id) ||
    typeof definition.label !== 'string' ||
    !definition.label.trim() ||
    typeof definition.run !== 'function'
  )
    throw new TypeError('a contribution needs id, label and run');
  if (definition.when !== undefined && typeof definition.when !== 'function') throw new TypeError('when must be a function');
  if (definition.order !== undefined && !Number.isFinite(definition.order)) throw new TypeError('order must be finite');
}

export function checkedShortcutKeys(input: readonly string[], existing: ReadonlyMap<string, readonly string[]>): readonly string[] {
  if (!Array.isArray(input) || !input.length || input.length > 8) throw new TypeError('a shortcut needs one to eight keys');
  const keys = input.map(normalizeShortcut);
  if (new Set(keys).size !== keys.length || Array.from(existing.values()).some((used) => used.some((key) => keys.includes(key))))
    throw new TypeError('shortcut keys conflict with an existing binding');
  return keys;
}
