import { isTypingTarget } from '../shortcuts.ts';
import { contributionOwner, type ShortcutDefinition } from '../plugins/contributions.ts';
import type { PluginContextFor } from '../plugins/PluginUi.tsx';
import { usePluginSnapshot } from '../plugins/PluginUi.tsx';
import { resolveSlot } from '../plugins/registry.ts';
import { useWindowKeydown } from './use-window-keydown.ts';

export function usePluginShortcuts(contextFor: PluginContextFor): void {
  usePluginSnapshot();
  const shortcuts = resolveSlot<undefined, ShortcutDefinition>('viewer.shortcuts', [], undefined);
  useWindowKeydown((event) => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (isTypingTarget(target) || target?.closest('[role="dialog"], [role="alertdialog"]') || !/^[a-z]$/i.test(event.key)) return;
    const key = event.shiftKey ? `Shift+${event.key.toUpperCase()}` : event.key.toLowerCase();
    for (const item of shortcuts) {
      const definition = item.render(undefined);
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
