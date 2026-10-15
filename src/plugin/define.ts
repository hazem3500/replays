import { PluginError } from './errors.ts';
import { PLUGIN_API_VERSION, type ReplaysPlugin } from './types.ts';

export const PLUGIN_NAME = /^[a-z][a-z0-9-]{0,39}$/;

/** Throws a `PluginError` unless `value` is a well-formed plugin. */
export function assertPlugin(value: unknown, where = 'plugin'): asserts value is ReplaysPlugin {
  if (!value || typeof value !== 'object') throw new PluginError('invalid-plugin', `${where} must be an object (use definePlugin)`);
  const plugin = value as Partial<ReplaysPlugin>;
  if (typeof plugin.name !== 'string' || !PLUGIN_NAME.test(plugin.name))
    throw new PluginError('invalid-plugin', `${where}.name must match ${PLUGIN_NAME} (got ${JSON.stringify(plugin.name)})`);
  const name = plugin.name;
  if (typeof plugin.setup !== 'function') throw new PluginError('invalid-plugin', 'setup must be a function', { plugin: name });
  if (plugin.apiVersion !== PLUGIN_API_VERSION)
    throw new PluginError('api-version', `needs plugin API ${String(plugin.apiVersion)}, this replays provides ${PLUGIN_API_VERSION}`, {
      plugin: name,
    });
  if (plugin.dependsOn !== undefined && (!Array.isArray(plugin.dependsOn) || plugin.dependsOn.some((entry) => typeof entry !== 'string')))
    throw new PluginError('invalid-plugin', 'dependsOn must be an array of plugin names', { plugin: name });
  if (plugin.order !== undefined && !Number.isFinite(plugin.order))
    throw new PluginError('invalid-plugin', 'order must be a finite number', { plugin: name });
}

type PluginInput = Omit<ReplaysPlugin, 'apiVersion'> & { apiVersion?: number };

/**
 * Declares a plugin. Either pass the plugin, or a function of the plugin's options that returns one (the usual
 * shape: `export default definePlugin((options: Options) => ({ name: 'acme', setup(api) { … } }))`, used as
 * `acme({ … })` in a config file).
 */
export function definePlugin(plugin: PluginInput): ReplaysPlugin;
export function definePlugin<Options = void>(factory: (options: Options) => PluginInput): (options: Options) => ReplaysPlugin;
export function definePlugin<Options>(input: PluginInput | ((options: Options) => PluginInput)) {
  const finish = (plugin: PluginInput): ReplaysPlugin => {
    const complete = Object.freeze({ ...plugin, apiVersion: plugin.apiVersion ?? PLUGIN_API_VERSION }) as ReplaysPlugin;
    assertPlugin(complete);
    return complete;
  };
  if (typeof input === 'function') return (options: Options) => finish(input(options));
  return finish(input);
}
