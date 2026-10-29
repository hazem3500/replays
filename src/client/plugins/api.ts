import type { PluginSettingDefinition } from '../../shared/plugin-settings.ts';
import type { PluginPageDefinition } from './pages.ts';
import type { SlotConfiguration, SlotDescriptor } from './slots.ts';
import type { ReplayBundle, ReplaySummary } from '../../shared/replay.ts';
import type { EditorToolDefinition, ExportFormatDefinition, ShortcutDefinition } from './contributions.ts';
export type {
  EditorToolContext,
  EditorToolDefinition,
  ExportFormatDefinition,
  ReplayExportFile,
  ShortcutDefinition,
} from './contributions.ts';
export type { PluginPageLoadContext, PluginPageContext, PluginPageDefinition } from './pages.ts';
export { ViewerRegistry } from './registry.ts';
export { SLOT_NAMES, SlotRegistry } from './slots.ts';
export type { SlotDescriptor, SlotConfiguration, SlotMountContext } from './slots.ts';

/*
 * The browser-side plugin API (`@hazem3500/replays/viewer`). A server plugin names a script with `api.client({ id, script })`;
 * the app imports it after the first paint, on every page (the index and the viewer), and calls its default export with a
 * `ViewerPluginApi`.
 *
 * Plugins draw into a DOM node the viewer hands them (`render(container, context)`), so they need no React and no
 * build tooling beyond producing one ES module. Return a function from `render` to clean up.
 */

export type Cleanup = void | (() => void);

/**
 * The browser plugin API generation. `defineViewerPlugin` stamps it on the plugin; a viewer of another generation refuses
 * the plugin (a console error naming both numbers) instead of calling it. It moves only in a major release.
 */
export const VIEWER_API_VERSION = 1;

/** What a tab, panel or action can see and do. Stable for one open replay. */
export interface ViewerPluginContext {
  /** The open replay, read-only by contract: metadata, steps, console, network, `context`. */
  readonly replay: Readonly<ReplayBundle>;
  /** The colour scheme right now (`dark` or `light`); read it again when you draw. */
  readonly theme: 'dark' | 'light';
  /** `''` at a domain's root, else the base path (`/replays`). */
  readonly basePath: string;
  /** The app's URL for an API path, e.g. `apiUrl('replays')` → `/replays/api/replays`. */
  apiUrl(path: string): string;
  /** Playhead position in ms from the start of the recording. */
  getTime(): number;
  /** Calls `listener` whenever the playhead moves; returns the unsubscribe function. */
  onTime(listener: (ms: number) => void): () => void;
  seek(ms: number): void;
  /** A short toast. */
  notify(message: string): void;
  /** This plugin's settings (registerSetting), as the person set them. */
  readonly settings: ViewerPluginSettings;
}

/** A setting's value: a boolean for `type: 'boolean'`, one of the option values for `type: 'choice'`. */
export type SettingValue = boolean | string;

export interface ViewerPluginSettings {
  /** The current value of one of this plugin's settings (its default until changed); undefined for an unknown id. */
  get(id: string): SettingValue | undefined;
  /** Calls `listener` when the person changes one of this plugin's settings; returns the unsubscribe function. */
  onChange(listener: (id: string, value: SettingValue) => void): () => void;
}

export interface InspectorTabDefinition {
  /** `[a-z][a-z0-9-]*`, unique within the plugin. */
  id: string;
  label: string;
  /** Lower first; built-in tabs come before plugin tabs. Default 0. */
  order?: number;
  render(container: HTMLElement, context: ViewerPluginContext): Cleanup;
}

export interface ViewerActionDefinition {
  id: string;
  label: string;
  order?: number;
  /**
   * Where the action lives: `more` (default) is an item in the header's More menu; `bar` is an icon button in the header,
   * beside the built-in actions, with the label as its tooltip. Phones keep bar actions in the More menu.
   */
  placement?: 'more' | 'bar';
  /** The button's glyph: a `data:image/svg+xml` URL or an https URL, drawn as an image. Default: a puzzle piece. */
  icon?: string;
  /** Return false to hide the action for this replay. */
  when?(context: ViewerPluginContext): boolean;
  run(context: ViewerPluginContext): void | Promise<void>;
}

export interface ViewerPanelDefinition {
  id: string;
  title: string;
  order?: number;
  /** Where the panel lives. `side` is a drawer on the right, opened from the header's More menu. */
  slot?: 'side';
  render(container: HTMLElement, context: ViewerPluginContext): Cleanup;
}

/* The index (the list of replays). It lists summaries, not bundles: what a column shows comes from `summary.ext`, which a
 * server plugin fills with `api.summaryFields`. */

/** What every index slot can see. */
export interface IndexPluginContext {
  /** The colour scheme right now (`dark` or `light`); read it again when you draw. */
  readonly theme: 'dark' | 'light';
  /** `''` at a domain's root, else the base path (`/replays`). */
  readonly basePath: string;
  /** The app's URL for an API path, e.g. `apiUrl('replays')` → `/replays/api/replays`. */
  apiUrl(path: string): string;
}

export interface IndexColumnContext extends IndexPluginContext {
  /** The row's replay summary; plugin values are in `summary.ext[<plugin name>]`. Read-only by contract. */
  readonly summary: Readonly<ReplaySummary>;
}

/** The signed-in person, as `GET /api/me` names them. */
export interface IndexPerson {
  readonly id: string;
  readonly name?: string;
  readonly email?: string;
  readonly avatarUrl?: string;
}

export interface IndexSectionContext extends IndexPluginContext {
  /** Every replay the list shows now (the server's answer for the current filters), newest first. */
  readonly summaries: readonly Readonly<ReplaySummary>[];
  /** The signed-in person; absent until known, or when the server cannot say. */
  readonly me?: IndexPerson;
}

export interface IndexColumnDefinition {
  /** `[a-z][a-z0-9-]*`, unique within the plugin. */
  id: string;
  /** What the field is (its accessible name). */
  label: string;
  /** Lower first. Default 0. */
  order?: number;
  /** Draws the field into a small inline box in one row (list rows and grid cards). Keep it to a line. */
  render(container: HTMLElement, context: IndexColumnContext): Cleanup;
}

export interface IndexFilterOption {
  value: string;
  label: string;
}

export interface IndexFilterDefinition {
  /** `[a-z][a-z0-9-]*`, unique within the plugin. */
  id: string;
  label: string;
  /** `switch`: on sets `<param>=1`. `choice`: one of `options`. `text`: free text (applied on Enter or leaving the field). */
  type: 'switch' | 'choice' | 'text';
  /** The query parameter, `x-<name>`; the server plugin's `api.indexFilter` with the same param does the matching. */
  param: string;
  /** For `choice`: the values on offer. */
  options?: readonly IndexFilterOption[];
  /** Lower first, after the built-in filters. Default 0. */
  order?: number;
}

export interface IndexSectionDefinition {
  /** `[a-z][a-z0-9-]*`, unique within the plugin. */
  id: string;
  title: string;
  /** Lower first. Default 0. */
  order?: number;
  /** Draws the section above the list. Return a function to clean up. */
  render(container: HTMLElement, context: IndexSectionContext): Cleanup;
  /**
   * Called instead of a fresh `render` when the list changes (new filters, a refresh, `me` arriving). Without it the
   * previous render is cleaned up and `render` runs again.
   */
  update?(container: HTMLElement, context: IndexSectionContext): void;
}

/** Most markers one track draws; the rest are dropped (with a console warning). */
export const MAX_TRACK_MARKERS = 500;

export type TimelineTone = 'neutral' | 'info' | 'warn' | 'error' | 'accent';

export interface TimelineMarker {
  /** Where it starts, in ms from the start of the recording. */
  atMs: number;
  /** A range when set: drawn from `atMs` for this long. */
  durationMs?: number;
  /** Shown on hover and focus, and in the marker's accessible name. */
  label: string;
  /** Its colour. Default `neutral`. */
  tone?: TimelineTone;
}

export interface TimelineTrackDefinition {
  id: string;
  /** Names the row (in each marker's accessible name and hover card). */
  label: string;
  /** Lower rows first, nearest the seek bar. Default 0. */
  order?: number;
  /** The track's markers for the open replay; called once per replay. A click on one seeks to its `atMs`. */
  markers(context: ViewerPluginContext): readonly TimelineMarker[] | Promise<readonly TimelineMarker[]>;
}

export interface ContextSectionDefinition {
  id: string;
  /** The block's heading inside the Context tab. */
  title: string;
  /** Lower first; sections come after the built-in groups. Default 0. */
  order?: number;
  render(container: HTMLElement, context: ViewerPluginContext): Cleanup;
}

export type SettingDefinition = PluginSettingDefinition;

export interface ViewerPluginApi {
  /** The server plugin's name (the one that served this script). */
  readonly pluginName: string;
  registerPluginPage(definition: PluginPageDefinition): void;
  registerEditorTool(definition: EditorToolDefinition): void;
  registerExportFormat(definition: ExportFormatDefinition): void;
  registerShortcut(definition: ShortcutDefinition): void;
  configureSlot(slot: string, configuration: SlotConfiguration): void;
  registerSlotItem<C, R>(slot: string, descriptor: SlotDescriptor<C, R>): void;
  registerInspectorTab(definition: InspectorTabDefinition): void;
  registerViewerAction(definition: ViewerActionDefinition): void;
  registerViewerPanel(definition: ViewerPanelDefinition): void;
  /** A field drawn in each replay row of the index. */
  registerIndexColumn(definition: IndexColumnDefinition): void;
  /** A control in the index's filter menu that sets a query parameter; the server does the matching. */
  registerIndexFilter(definition: IndexFilterDefinition): void;
  /** A block above the index's list. */
  registerIndexSection(definition: IndexSectionDefinition): void;
  /** A row of markers or ranges under the seek bar. */
  registerTimelineTrack(definition: TimelineTrackDefinition): void;
  /** A block inside the built-in Context tab (not a tab of its own). */
  registerContextSection(definition: ContextSectionDefinition): void;
  /** A per-person preference in the More menu, stored in the browser; read it with `context.settings`. */
  registerSetting(definition: SettingDefinition): void;
}

export type ViewerPlugin = ((api: ViewerPluginApi) => void | Promise<void>) & {
  /** The generation the plugin was built for; `defineViewerPlugin` fills it in. Absent on a bare function (accepted). */
  readonly apiVersion?: number;
};

/** Marks and types the default export of a client entry, and stamps it with `VIEWER_API_VERSION`. */
export function defineViewerPlugin(plugin: (api: ViewerPluginApi) => void | Promise<void>): ViewerPlugin {
  if (typeof plugin !== 'function') throw new TypeError('defineViewerPlugin needs a function (api) => void');
  // A wrapper, so stamping never mutates (or fails on) the caller's function.
  const stamped = (api: ViewerPluginApi) => plugin(api);
  return Object.defineProperty(stamped, 'apiVersion', { value: VIEWER_API_VERSION, enumerable: true });
}
