import { afterEach, describe, expect, it, vi } from 'vitest';

import { defineViewerPlugin, type ViewerPluginApi } from '../src/client/plugins/api.ts';
import { loadClientPlugins, readClientEntries } from '../src/client/plugins/load.ts';
import { ViewerPluginError, ViewerRegistry } from '../src/client/plugins/registry.ts';

const render = () => {};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ViewerRegistry', () => {
  it('registers tabs, actions and panels under `plugin:<plugin>:<id>` and notifies subscribers', () => {
    const registry = new ViewerRegistry();
    const listener = vi.fn<() => void>();
    registry.subscribe(listener);
    const api = registry.apiFor('acme');
    api.registerInspectorTab({ id: 'build', label: 'Build', render });
    api.registerViewerAction({ id: 'copy', label: 'Copy', run: () => {} });
    api.registerViewerPanel({ id: 'notes', title: 'Notes', render });
    const snapshot = registry.getSnapshot();
    expect(snapshot.tabs.map((tab) => tab.key)).toEqual(['plugin:acme:build']);
    expect(snapshot.actions.map((action) => action.key)).toEqual(['plugin:acme:copy']);
    expect(snapshot.panels.map((panel) => panel.key)).toEqual(['plugin:acme:notes']);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('gives each plugin its own id space, but not two registrations of one id', () => {
    const registry = new ViewerRegistry();
    registry.apiFor('a').registerInspectorTab({ id: 'x', label: 'A', render });
    registry.apiFor('b').registerInspectorTab({ id: 'x', label: 'B', render });
    expect(registry.getSnapshot().tabs.map((tab) => tab.key)).toEqual(['plugin:a:x', 'plugin:b:x']);
    expect(() => registry.apiFor('a').registerInspectorTab({ id: 'x', label: 'again', render })).toThrow(
      new ViewerPluginError('a: tabs "x" is registered twice'),
    );
    // A tab, an action and a panel may share an id.
    registry.apiFor('a').registerViewerAction({ id: 'x', label: 'X', run: () => {} });
  });

  it('orders by `order`, then by registration', () => {
    const registry = new ViewerRegistry();
    const api = registry.apiFor('p');
    api.registerInspectorTab({ id: 'c', label: 'C', render });
    api.registerInspectorTab({ id: 'a', label: 'A', render, order: -1 });
    api.registerInspectorTab({ id: 'b', label: 'B', render });
    expect(registry.getSnapshot().tabs.map((tab) => tab.definition.id)).toEqual(['a', 'c', 'b']);
  });

  it.each([
    ['an id with capitals', (api: ViewerPluginApi) => api.registerInspectorTab({ id: 'Bad', label: 'x', render }), /id must match/],
    ['no label', (api: ViewerPluginApi) => api.registerInspectorTab({ id: 'ok', label: ' ', render }), /needs a label/],
    ['no render function', (api: ViewerPluginApi) => api.registerViewerPanel({ id: 'ok', title: 'x' } as never), /needs a render function/],
    ['no run function', (api: ViewerPluginApi) => api.registerViewerAction({ id: 'ok', label: 'x' } as never), /needs a run function/],
    [
      'a non-numeric order',
      (api: ViewerPluginApi) => api.registerInspectorTab({ id: 'ok', label: 'x', render, order: Number.NaN }),
      /order must be a number/,
    ],
    ['nothing at all', (api: ViewerPluginApi) => api.registerInspectorTab(undefined as never), /id must match/],
  ])('refuses %s', (_label, register, message) => {
    const registry = new ViewerRegistry();
    expect(() => register(registry.apiFor('p'))).toThrow(message);
    expect(registry.getSnapshot().tabs).toHaveLength(0);
  });

  it('can be reset, and unsubscribed from', () => {
    const registry = new ViewerRegistry();
    const listener = vi.fn<() => void>();
    const unsubscribe = registry.subscribe(listener);
    unsubscribe();
    registry.apiFor('p').registerInspectorTab({ id: 'a', label: 'A', render });
    expect(listener).not.toHaveBeenCalled();
    registry.reset();
    expect(registry.getSnapshot().tabs).toEqual([]);
  });
});

describe('loadClientPlugins', () => {
  it('imports each entry, passes it the API for its plugin, and awaits an async entry', async () => {
    const registry = new ViewerRegistry();
    const urls: string[] = [];
    await loadClientPlugins(
      [
        { plugin: 'one', id: 'main', script: '/base/_plugins/one/main.js' },
        { plugin: 'two', id: 'main', script: 'https://cdn.example.com/two.js' },
      ],
      registry,
      async (url) => {
        urls.push(url);
        return {
          default: defineViewerPlugin(async (api) => {
            await Promise.resolve();
            api.registerInspectorTab({ id: 'tab', label: api.pluginName, render });
          }),
        };
      },
    );
    expect(urls).toEqual(['http://localhost/base/_plugins/one/main.js', 'https://cdn.example.com/two.js']);
    expect(
      registry
        .getSnapshot()
        .tabs.map((tab) => tab.key)
        .sort(),
    ).toEqual(['plugin:one:tab', 'plugin:two:tab']);
  });

  it('isolates failures: a throwing entry, a bad default export and a failed import do not stop the others', async () => {
    const registry = new ViewerRegistry();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await loadClientPlugins(
      [
        { plugin: 'throws', id: 'main', script: '/a.js' },
        { plugin: 'bad-export', id: 'main', script: '/b.js' },
        { plugin: 'missing', id: 'main', script: '/c.js' },
        { plugin: 'good', id: 'main', script: '/d.js' },
      ],
      registry,
      async (url) => {
        if (url.endsWith('/a.js'))
          return {
            default: () => {
              throw new Error('entry bug');
            },
          };
        if (url.endsWith('/b.js')) return { default: 'not a function' };
        if (url.endsWith('/c.js')) throw new Error('404');
        return { default: (api: ViewerPluginApi) => api.registerViewerAction({ id: 'go', label: 'Go', run: () => {} }) };
      },
    );
    expect(registry.getSnapshot().actions.map((action) => action.key)).toEqual(['plugin:good:go']);
    expect(error).toHaveBeenCalledTimes(3);
    expect(String(error.mock.calls[0]?.[0])).toContain('plugin throws (main) failed to load');
  });

  it('keeps what an entry registered before it failed', async () => {
    const registry = new ViewerRegistry();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await loadClientPlugins([{ plugin: 'p', id: 'main', script: '/a.js' }], registry, async () => ({
      default: (api: ViewerPluginApi) => {
        api.registerInspectorTab({ id: 'one', label: 'One', render });
        api.registerInspectorTab({ id: 'BAD', label: 'Two', render });
      },
    }));
    expect(registry.getSnapshot().tabs.map((tab) => tab.key)).toEqual(['plugin:p:one']);
  });
});

describe('readClientEntries', () => {
  const withMeta = (content: string | undefined) =>
    vi.stubGlobal('document', { querySelector: () => (content === undefined ? null : { content }) });

  it('reads the server’s JSON list', () => {
    withMeta(JSON.stringify([{ plugin: 'a', id: 'main', script: '/s.js', style: '/s.css' }]));
    expect(readClientEntries()).toEqual([{ plugin: 'a', id: 'main', script: '/s.js', style: '/s.css' }]);
  });

  it('treats a missing, empty, malformed or wrongly shaped meta as no plugins', () => {
    for (const content of [undefined, '', '{nope', '{"a":1}', JSON.stringify([{ plugin: 'a' }, 3, null])]) {
      withMeta(content);
      expect(readClientEntries()).toEqual([]);
    }
  });

  it('is empty without a document', () => {
    expect(readClientEntries()).toEqual([]);
  });
});
