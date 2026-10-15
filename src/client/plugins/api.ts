import type { ReplayBundle } from '../../shared/replay.ts';

/*
 * The browser-side plugin API (`@hazem3500/replays/viewer`). A server plugin names a script with `api.client({ id, script })`;
 * the viewer imports it after the page loads and calls its default export with a `ViewerPluginApi`.
 *
 * Plugins draw into a DOM node the viewer hands them (`render(container, context)`), so they need no React and no
 * build tooling beyond producing one ES module. Return a function from `render` to clean up.
 */

export type Cleanup = void | (() => void);

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

export interface ViewerPluginApi {
  /** The server plugin's name (the one that served this script). */
  readonly pluginName: string;
  registerInspectorTab(definition: InspectorTabDefinition): void;
  registerViewerAction(definition: ViewerActionDefinition): void;
  registerViewerPanel(definition: ViewerPanelDefinition): void;
}

export type ViewerPlugin = (api: ViewerPluginApi) => void | Promise<void>;

/** Marks and types the default export of a client entry. */
export function defineViewerPlugin(plugin: ViewerPlugin): ViewerPlugin {
  return plugin;
}
