import { PuzzleIcon, XIcon } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import type { ReplayBundle } from '../../shared/replay.ts';
import type { ReplayController } from '../player.ts';
import { apiUrl, appBase } from '../route.ts';
import { notify as showToast } from '../toast.ts';
import type { TopbarMenuItem } from '../Topbar.tsx';
import type { Cleanup, ViewerPluginContext } from './api.ts';
import { viewerRegistry } from './registry.ts';

export function usePluginSnapshot() {
  return useSyncExternalStore(viewerRegistry.subscribe, viewerRegistry.getSnapshot);
}

/** The context plugin code receives for one open replay. */
export function usePluginContext(bundle: ReplayBundle, player: ReplayController): ViewerPluginContext {
  return useMemo<ViewerPluginContext>(
    () => ({
      replay: bundle,
      get theme() {
        return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
      },
      basePath: appBase(),
      apiUrl: (path) => apiUrl(path),
      getTime: () => player.getTime(),
      onTime: (listener) => player.subscribeTime(() => listener(player.getTime())),
      seek: (ms) => player.seek(ms),
      notify: (message) => showToast(message),
    }),
    [bundle, player],
  );
}

/** Runs a plugin's `render(container, context)` into a div and cleans up on unmount. A throwing plugin shows an error line. */
export function PluginMount({
  render,
  context,
  label,
  testId,
  className,
}: {
  render: (container: HTMLElement, context: ViewerPluginContext) => Cleanup;
  context: ViewerPluginContext;
  label: string;
  testId?: string;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    container.replaceChildren();
    let cleanup: Cleanup;
    try {
      cleanup = render(container, context);
    } catch (error) {
      console.error(`plugin view "${label}" failed:`, error);
      container.textContent = `${label} could not be shown.`;
    }
    return () => {
      try {
        if (typeof cleanup === 'function') cleanup();
      } catch (error) {
        console.error(`plugin view "${label}" cleanup failed:`, error);
      }
      container.replaceChildren();
    };
  }, [render, context, label]);
  return <div ref={host} className={className ?? 'plugin-mount'} data-testid={testId} />;
}

/** Plugin actions and panel entries as "More" menu items, plus the side drawer that open panels render in. */
export function usePluginMenu(bundle: ReplayBundle, player: ReplayController): { items: TopbarMenuItem[]; drawer: ReactNode } {
  const snapshot = usePluginSnapshot();
  const context = usePluginContext(bundle, player);
  const [openPanel, setOpenPanel] = useState<string>();
  const items = useMemo<TopbarMenuItem[]>(() => {
    const visible = snapshot.actions.filter((action) => {
      try {
        return action.definition.when?.(context) !== false;
      } catch {
        return false;
      }
    });
    return [
      ...visible.map((action) => ({
        label: action.definition.label,
        icon: <PuzzleIcon aria-hidden="true" />,
        testId: `plugin-action:${action.plugin}:${action.definition.id}`,
        onSelect: () => {
          void Promise.resolve()
            .then(() => action.definition.run(context))
            .catch((error: unknown) => {
              console.error(`plugin action "${action.definition.label}" failed:`, error);
              showToast(`${action.definition.label} failed`);
            });
        },
      })),
      ...snapshot.panels.map((panel) => ({
        label: panel.definition.title,
        icon: <PuzzleIcon aria-hidden="true" />,
        testId: `plugin-panel-open:${panel.plugin}:${panel.definition.id}`,
        onSelect: () => setOpenPanel((current) => (current === panel.key ? undefined : panel.key)),
      })),
    ];
  }, [snapshot, context]);
  const active = snapshot.panels.find((panel) => panel.key === openPanel);
  const drawer = active
    ? createPortal(
        <aside
          className="plugin-drawer"
          aria-label={active.definition.title}
          data-testid={`plugin-panel:${active.plugin}:${active.definition.id}`}
        >
          <header className="plugin-drawer-head">
            <h2>{active.definition.title}</h2>
            <button
              type="button"
              className="plugin-drawer-close"
              aria-label={`Close ${active.definition.title}`}
              onClick={() => setOpenPanel(undefined)}
            >
              <XIcon aria-hidden="true" />
            </button>
          </header>
          <PluginMount render={active.definition.render} context={context} label={active.definition.title} className="plugin-drawer-body" />
        </aside>,
        document.body,
      )
    : null;
  return { items, drawer };
}
