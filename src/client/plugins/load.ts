import type { ViewerPlugin } from './api.ts';
import { viewerRegistry, type ViewerRegistry } from './registry.ts';

export interface ClientEntryInfo {
  plugin: string;
  id: string;
  script: string;
  style?: string;
}

/** The entries the server wrote into `<meta name="app-plugins">`; malformed content means none. */
export function readClientEntries(): ClientEntryInfo[] {
  if (typeof document === 'undefined') return [];
  const content = document.querySelector<HTMLMetaElement>('meta[name="app-plugins"]')?.content;
  if (!content) return [];
  try {
    const parsed: unknown = JSON.parse(content);
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is ClientEntryInfo =>
            typeof entry?.plugin === 'string' && typeof entry.script === 'string' && typeof entry.id === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

/**
 * Imports each entry and runs its default export. A failing plugin is logged and skipped: it never breaks the
 * viewer or the other plugins. Resolves when all have settled.
 */
export async function loadClientPlugins(
  entries: readonly ClientEntryInfo[] = readClientEntries(),
  registry: ViewerRegistry = viewerRegistry,
  importer: (url: string) => Promise<{ default?: unknown }> = (url) => import(/* @vite-ignore */ url),
) {
  await Promise.all(
    entries.map(async (entry) => {
      try {
        if (entry.style && typeof document !== 'undefined') {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = entry.style;
          link.dataset.plugin = entry.plugin;
          document.head.append(link);
        }
        const url = new URL(entry.script, typeof location === 'undefined' ? 'http://localhost/' : location.href).href;
        const loaded = await importer(url);
        if (typeof loaded.default !== 'function') throw new Error('the entry must default-export a function (defineViewerPlugin)');
        await (loaded.default as ViewerPlugin)(registry.apiFor(entry.plugin));
      } catch (error) {
        console.error(`plugin ${entry.plugin} (${entry.id}) failed to load:`, error);
      }
    }),
  );
}
