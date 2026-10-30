import { PluginError } from './errors.ts';
import type { ReplaysPlugin } from './types.ts';

/**
 * Plugin order: dependencies first, then by `order`, then by position in the config. Throws on a missing dependency,
 * a duplicate name or a cycle.
 */
export function orderPlugins(plugins: readonly ReplaysPlugin[]): ReplaysPlugin[] {
  const byName = new Map<string, ReplaysPlugin>();
  for (const plugin of plugins) {
    if (byName.has(plugin.name)) throw new PluginError('duplicate-plugin', 'is listed twice', { plugin: plugin.name });
    byName.set(plugin.name, plugin);
  }
  for (const plugin of plugins)
    for (const dependency of plugin.dependsOn ?? [])
      if (!byName.has(dependency))
        throw new PluginError('missing-dependency', `depends on ${JSON.stringify(dependency)}, which is not in the config`, {
          plugin: plugin.name,
        });
  const position = new Map(plugins.map((plugin, index) => [plugin.name, index]));
  const rank = (plugin: ReplaysPlugin) => [plugin.order ?? 0, position.get(plugin.name) ?? 0] as const;
  const pending = [...plugins];
  const done = new Set<string>();
  const ordered: ReplaysPlugin[] = [];
  while (pending.length) {
    const ready = pending.filter((plugin) => (plugin.dependsOn ?? []).every((dependency) => done.has(dependency)));
    if (!ready.length)
      throw new PluginError('dependency-cycle', `dependency cycle among ${pending.map((plugin) => plugin.name).join(', ')}`);
    const next = ready.reduce((best, plugin) => {
      const [a, b] = [rank(plugin), rank(best)];
      return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? plugin : best;
    });
    pending.splice(pending.indexOf(next), 1);
    done.add(next.name);
    ordered.push(next);
  }
  return ordered;
}
