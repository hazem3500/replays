import { PuzzleIcon, XIcon } from 'lucide-react';
import { createContext, Fragment, type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import { isSafeIconUrl } from '../../shared/icon-url.ts';
import type { ReplayBundle } from '../../shared/replay.ts';
import { IconButton } from '@/components/icon-button.tsx';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu.tsx';
import type { ReplayController } from '../player.ts';
import { apiUrl, appBase } from '../route.ts';
import { notify as showToast } from '../toast.ts';
import type { TopbarMenuItem } from '../Topbar.tsx';
import type { Cleanup, SettingDefinition, ViewerActionDefinition, ViewerPluginContext } from './api.ts';
import { viewerRegistry } from './registry.ts';
import { pluginSettings, readSetting, subscribeSettings, writeSetting } from './settings.ts';

export function usePluginSnapshot() {
  return useSyncExternalStore(viewerRegistry.subscribe, viewerRegistry.getSnapshot);
}

/** The context one plugin's code receives for one open replay (`settings` are that plugin's own). */
export function createPluginContext(bundle: ReplayBundle, player: ReplayController, plugin: string): ViewerPluginContext {
  return {
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
    settings: pluginSettings(plugin),
  };
}

/** A context for code that is not one host plugin's (the malleable host); its `settings` are empty. */
export function usePluginContext(bundle: ReplayBundle, player: ReplayController): ViewerPluginContext {
  return useMemo(() => createPluginContext(bundle, player, ''), [bundle, player]);
}

/** Each plugin's context for the open replay, made once per plugin and kept while the replay is open. */
export type PluginContextFor = (plugin: string) => ViewerPluginContext;

function pluginContexts(bundle: ReplayBundle, player: ReplayController): PluginContextFor {
  const made = new Map<string, ViewerPluginContext>();
  return (plugin) => {
    let context = made.get(plugin);
    if (!context) {
      context = createPluginContext(bundle, player, plugin);
      made.set(plugin, context);
    }
    return context;
  };
}

export function usePluginContexts(bundle: ReplayBundle, player: ReplayController): PluginContextFor {
  return useMemo(() => pluginContexts(bundle, player), [bundle, player]);
}

/** The viewer's PluginContextFor, for parts that do not hold the bundle (the seek bar, the Context tab). */
export const PluginContexts = createContext<PluginContextFor | null>(null);

/** Draws a failed plugin view's error line into its container (`data-plugin-error`), after logging the error. */
export function showPluginError(container: HTMLElement, label: string, error: unknown) {
  console.error(`plugin view "${label}" failed:`, error);
  container.replaceChildren();
  container.dataset.pluginError = '';
  container.textContent = `${label} could not be shown.`;
}

/**
 * Runs a plugin's `render(container, context)` into an element and cleans up on unmount; a new `context` renders again.
 * A throwing plugin shows an error line.
 */
export function PluginMount<C>({
  render,
  context,
  label,
  testId,
  className,
  inline = false,
}: {
  render: (container: HTMLElement, context: C) => Cleanup;
  context: C;
  label: string;
  testId?: string;
  className?: string;
  /** A `span` (for a slot inside a line of text) instead of a `div`. */
  inline?: boolean;
}) {
  const host = useRef<HTMLDivElement & HTMLSpanElement>(null);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    container.replaceChildren();
    delete container.dataset.pluginError;
    let cleanup: Cleanup;
    try {
      cleanup = render(container, context);
    } catch (error) {
      showPluginError(container, label, error);
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
  const Tag = inline ? 'span' : 'div';
  return <Tag ref={host} className={className ?? 'plugin-mount'} data-testid={testId} />;
}

/** An action's glyph: its own icon (a safe image URL, drawn as an <img>), else the puzzle piece. */
function ActionIcon({ icon }: { icon: string | undefined }) {
  return icon && isSafeIconUrl(icon) ? (
    <img src={icon} alt="" width={16} height={16} className="plugin-action-icon" referrerPolicy="no-referrer" draggable={false} />
  ) : (
    <PuzzleIcon aria-hidden="true" />
  );
}

function runAction(action: ViewerActionDefinition, context: ViewerPluginContext) {
  void Promise.resolve()
    .then(() => action.run(context))
    .catch((error: unknown) => {
      console.error(`plugin action "${action.label}" failed:`, error);
      showToast(`${action.label} failed`);
    });
}

/**
 * Client plugins in the header: More-menu actions and panel entries (`items`), bar actions as icon buttons (`bar`; on
 * phones they join the menu), the plugins' settings for the bottom of the menu (`settings`), and the side drawer that
 * open panels render in.
 */
export function usePluginMenu(
  contextFor: PluginContextFor,
  mobile = false,
): { items: TopbarMenuItem[]; bar: ReactNode; settings: ReactNode; drawer: ReactNode } {
  const snapshot = usePluginSnapshot();
  const [openPanel, setOpenPanel] = useState<string>();
  const { items, bar } = useMemo(() => {
    const visible = snapshot.actions.filter((action) => {
      try {
        return action.definition.when?.(contextFor(action.plugin)) !== false;
      } catch {
        return false;
      }
    });
    const inBar = mobile ? [] : visible.filter((action) => action.definition.placement === 'bar');
    const inMenu = visible.filter((action) => !inBar.includes(action));
    return {
      bar: inBar.length ? (
        <>
          {inBar.map((action) => (
            <IconButton
              key={action.key}
              label={action.definition.label}
              tooltipSide="bottom"
              tooltipAlign="end"
              className="plugin-bar-action"
              data-testid={`plugin-action:${action.plugin}:${action.definition.id}`}
              onClick={() => runAction(action.definition, contextFor(action.plugin))}
            >
              <ActionIcon icon={action.definition.icon} />
            </IconButton>
          ))}
        </>
      ) : null,
      items: [
        ...inMenu.map((action) => ({
          label: action.definition.label,
          icon: <ActionIcon icon={action.definition.icon} />,
          testId: `plugin-action:${action.plugin}:${action.definition.id}`,
          onSelect: () => runAction(action.definition, contextFor(action.plugin)),
        })),
        ...snapshot.panels.map((panel) => ({
          label: panel.definition.title,
          icon: <PuzzleIcon aria-hidden="true" />,
          testId: `plugin-panel-open:${panel.plugin}:${panel.definition.id}`,
          onSelect: () => setOpenPanel((current) => (current === panel.key ? undefined : panel.key)),
        })),
      ] satisfies TopbarMenuItem[],
    };
  }, [snapshot, contextFor, mobile]);
  const settings = useMemo(
    () => (snapshot.settings.length ? <PluginSettingsMenu settings={snapshot.settings} /> : null),
    [snapshot.settings],
  );
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
          <PluginMount
            render={active.definition.render}
            context={contextFor(active.plugin)}
            label={active.definition.title}
            className="plugin-drawer-body"
          />
        </aside>,
        document.body,
      )
    : null;
  return { items, bar, settings, drawer };
}

/**
 * The plugins' settings at the bottom of the More menu: switches as check items under "Settings", each choice as its
 * own labelled group of radio items. Changing one keeps the menu open, stores it and tells the plugin.
 */
function PluginSettingsMenu({ settings }: { settings: ReturnType<typeof usePluginSnapshot>['settings'] }) {
  const switches = settings.filter((setting) => setting.definition.type === 'boolean');
  const choices = settings.filter((setting) => setting.definition.type === 'choice');
  return (
    <>
      {switches.length ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Settings</DropdownMenuLabel>
            {switches.map(({ plugin, key, definition }) => (
              <PluginSettingCheckbox key={key} plugin={plugin} definition={definition} />
            ))}
          </DropdownMenuGroup>
        </>
      ) : null}
      {choices.map(({ plugin, key, definition }) => (
        <PluginSettingChoice key={key} plugin={plugin} definition={definition} />
      ))}
    </>
  );
}

/** Storage is external state: subscribing its primitive value also makes changes visible to memoized renders. */
function useSettingValue(plugin: string, definition: SettingDefinition) {
  return useSyncExternalStore(subscribeSettings, () => readSetting(plugin, definition));
}

function PluginSettingCheckbox({ plugin, definition }: { plugin: string; definition: SettingDefinition }) {
  const value = useSettingValue(plugin, definition);
  return (
    <DropdownMenuCheckboxItem
      checked={value === true}
      onCheckedChange={(checked) => writeSetting(plugin, definition, checked)}
      closeOnClick={false}
      inset
      data-testid={`plugin-setting:${plugin}:${definition.id}`}
    >
      {definition.label}
    </DropdownMenuCheckboxItem>
  );
}

function PluginSettingChoice({ plugin, definition }: { plugin: string; definition: SettingDefinition }) {
  const value = useSettingValue(plugin, definition);
  if (definition.type !== 'choice') return null;
  return (
    <Fragment>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>{definition.label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => writeSetting(plugin, definition, String(next))}>
          {definition.options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              closeOnClick={false}
              inset
              data-testid={`plugin-setting:${plugin}:${definition.id}:${option.value}`}
            >
              {option.label ?? option.value}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
    </Fragment>
  );
}
