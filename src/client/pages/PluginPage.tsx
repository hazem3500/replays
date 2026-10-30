import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import { apiUrl, appBase } from '../api/fetch.ts';
import { useDocumentTitle } from '../hooks/use-document-title.ts';
import { productName } from '../config.ts';
import type { Cleanup } from '../plugins/api.ts';
import { pluginsSettled, subscribePluginsSettled } from '../plugins/load.ts';
import { type PluginPageContext, type PluginPageDefinition, pluginPagePath } from '../plugins/pages.ts';
import { PluginMount } from '../plugins/PluginUi.tsx';
import { viewerRegistry } from '../plugins/registry.ts';
import { navigate } from '../routing/navigate.ts';
import { stringifySearch } from '../routing/search.ts';
import { failureCopy, NotFoundPage, StateShell, TRY_AGAIN } from '../routing/states.tsx';

interface Props {
  plugin: string;
  path: string;
  search: Readonly<Record<string, unknown>>;
}

/**
 * A plugin's page (`/p/<plugin>/<path>`), drawn by the plugin into its container. It waits for the server's plugin
 * entries before deciding the page is missing, and follows later registrations (hot reload, removal).
 */
export function PluginPage({ plugin, path, search }: Props) {
  const pages = viewerRegistry.pages;
  useSyncExternalStore(pages.subscribe, pages.snapshot, pages.snapshot);
  const settled = useSyncExternalStore(subscribePluginsSettled, pluginsSettled, () => false);
  const page = pages.get(plugin);
  useDocumentTitle(page ? `${page.title} · ${productName()}` : undefined);
  if (!page) return settled ? <NotFoundPage /> : null;
  return <LoadedPluginPage key={plugin} plugin={plugin} page={page} path={path} search={search} />;
}

function LoadedPluginPage({ plugin, page, path, search }: Props & { page: PluginPageDefinition }) {
  const loaded = useQuery({
    queryKey: ['plugin-page', plugin, path, search],
    queryFn: async ({ signal }) => ({ data: await page.loader?.({ path, search, signal }) }),
    staleTime: 0,
    gcTime: 0,
    // why: the page's data changes only when its address does; a refocus must not redraw the plugin.
    refetchOnWindowFocus: false,
  });
  if (loaded.error)
    return (
      <StateShell {...failureCopy('page', loaded.error.message)} secondary={TRY_AGAIN} />
    );
  if (!loaded.data) return null;
  const context = pageContext(plugin, path, search, loaded.data.data);
  const render = pageRenderer(page);
  return (
    <main className="plugin-page" data-plugin={plugin}>
      <PluginMount render={render} context={context} label={`${plugin} page`} testId="plugin-page" slot="plugin.page" />
    </main>
  );
}

/** What a plugin's page gets besides its signal: theme, base path, API URLs, its address, its data and navigation. */
function pageContext(plugin: string, path: string, search: Props['search'], data: unknown): Omit<PluginPageContext, 'signal'> {
  return {
    get theme() {
      return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    },
    basePath: appBase(),
    apiUrl,
    path,
    search,
    data,
    navigate: (next, nextSearch = {}) => {
      const splat = pluginPagePath(plugin, next);
      if (splat === undefined) throw new Error(`${plugin}: navigate("${next}") leaves the plugin's page`);
      navigate(`${appBase()}/p/${encodeURIComponent(plugin)}/${splat}${stringifySearch(nextSearch)}`);
    },
  };
}

/** Draws the page with a signal that aborts when it unmounts or draws again. */
function pageRenderer(page: PluginPageDefinition) {
  return (container: HTMLElement, base: Omit<PluginPageContext, 'signal'>): Cleanup => {
    const controller = new AbortController();
    const cleanup = page.render(container, { ...base, signal: controller.signal });
    return () => {
      controller.abort();
      if (typeof cleanup === 'function') cleanup();
    };
  };
}
