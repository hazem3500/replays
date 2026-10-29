import { isTypingTarget } from '../shortcuts.ts';
import { contributionOwner, type ShortcutDefinition } from '../plugins/contributions.ts';
import type { PluginContextFor } from '../plugins/PluginUi.tsx';
import { usePluginSnapshot } from '../plugins/PluginUi.tsx';
import { resolveSlot } from '../plugins/registry.ts';
import { useWindowKeydown } from './use-window-keydown.ts';

function ignoresShortcut(event: KeyboardEvent): boolean {
  const target = event.target instanceof HTMLElement ? event.target : null;
  return (
    event.defaultPrevented ||
    event.isComposing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    isTypingTarget(target) ||
    Boolean(target?.closest('[role="dialog"], [role="alertdialog"]')) ||
    !/^[a-z]$/i.test(event.key)
  );
}

export function usePluginShortcuts(contextFor: PluginContextFor): void {
  usePluginSnapshot();
  const shortcuts = resolveSlot<null, ShortcutDefinition>('viewer.shortcuts', [], null);
  useWindowKeydown((event) => {
    if (ignoresShortcut(event)) return;
    const key = event.shiftKey ? `Shift+${event.key.toUpperCase()}` : event.key.toLowerCase();
    for (const item of shortcuts) {
      const definition = item.render(null);
      if (!definition.keys.includes(key)) continue;
      const context = contextFor(contributionOwner(item.id));
      try {
        if (definition.when && !definition.when(context)) continue;
        event.preventDefault();
        void Promise.resolve(definition.run(context)).catch(() => context.notify('The shortcut could not run'));
      } catch {
        context.notify('The shortcut could not run');
      }
      break;
    }
  });
}
