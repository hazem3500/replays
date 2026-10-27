import type { Cleanup, IndexPluginContext } from './api.ts';

/** What a plugin page's loader gets: where in the plugin it is, and a signal that aborts when the page goes away. */
export interface PluginPageLoadContext {
  /** The path under the plugin's page (`/p/<plugin>/<path>`), without a leading slash; `''` at its root. */
  readonly path: string;
  readonly search: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}

export interface PluginPageContext extends IndexPluginContext, PluginPageLoadContext {
  /** What the loader returned (undefined without one). */
  readonly data: unknown;
  /** Another path of this plugin's page; `..`, other plugins and other sites are refused. */
  navigate(path: string, search?: Record<string, unknown>): void | Promise<void>;
}

export interface PluginPageDefinition {
  title: string;
  loader?(context: PluginPageLoadContext): unknown;
  render(container: HTMLElement, context: PluginPageContext): Cleanup;
}

export interface PluginPageState {
  readonly pages: ReadonlyMap<string, PluginPageDefinition>;
}

/** One page per plugin, at `/p/<plugin>/…`. A store: the route re-renders when a plugin registers its page. */
export class PluginPageRegistry {
  private pages = new Map<string, PluginPageDefinition>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  register(plugin: string, definition: PluginPageDefinition) {
    if (typeof definition?.render !== 'function') throw new Error(`${plugin}: a page needs render(container, context)`);
    if (typeof definition.title !== 'string' || !definition.title.trim()) throw new Error(`${plugin}: a page needs a title`);
    if (definition.loader !== undefined && typeof definition.loader !== 'function') throw new Error(`${plugin}: loader must be a function`);
    if (this.pages.has(plugin)) throw new Error(`${plugin}: already registered a page`);
    this.pages.set(plugin, definition);
    this.changed();
  }

  get(plugin: string) {
    return this.pages.get(plugin);
  }

  removeOwner(plugin: string) {
    if (this.pages.delete(plugin)) this.changed();
  }

  checkpoint(): PluginPageState {
    return { pages: new Map(this.pages) };
  }

  restore(state: PluginPageState) {
    this.pages = new Map(state.pages);
    this.changed();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** Changes whenever a page is added or removed (for useSyncExternalStore). */
  snapshot = () => this.version;

  private changed() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}

/**
 * A plugin-relative path as the splat under `/p/<plugin>/`, or undefined when it would leave the plugin: a scheme,
 * a protocol-relative or backslashed URL, a `.`/`..` segment (also percent-encoded), or another plugin's page.
 */
export function pluginPagePath(plugin: string, path: string): string | undefined {
  if (typeof path !== 'string' || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//') || path.includes('\\')) return undefined;
  let rest = path;
  const own = `/p/${plugin}`;
  if (rest === own || rest.startsWith(`${own}/`)) rest = rest.slice(own.length);
  else if (/^\/p(\/|$)/.test(rest)) return undefined;
  const segments = rest.split('/').filter(Boolean);
  let decoded: string[];
  try {
    decoded = segments.map((segment) => decodeURIComponent(segment));
  } catch {
    return undefined;
  }
  if (decoded.some((segment) => segment === '.' || segment === '..' || /[/\\]/.test(segment))) return undefined;
  return segments.join('/');
}
