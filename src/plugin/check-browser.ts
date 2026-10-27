import type { ViewerPlugin } from '../client/plugins/api.ts';
import type { ViewerRegistry } from '../client/plugins/registry.ts';
import type { ReplayBundle } from '../shared/replay.ts';
import type { UserPluginFile } from '../shared/malleable.ts';

/** Self-contained browser harness; bundled into the check page, never into the application. */
export async function checkBrowserEntry(entry: ViewerPlugin, Registry: typeof ViewerRegistry) {
  const output: string[] = [];
  const errors: string[] = [];
  const registry = new Registry();
  const replay = (await (await fetch('/fixture.json')).json()) as ReplayBundle;
  const context = {
    replay,
    theme: 'dark' as const,
    basePath: '',
    apiUrl: (path: string) => `/fixture-api/${path}`,
    getTime: () => 0,
    onTime: () => () => {},
    seek: (ms: number) => output.push(`seek ${ms}`),
    notify: (message: string) => output.push(`notify ${message}`),
    settings: {
      get: (id: string) =>
        registry.getSnapshot().settings.find((setting) => setting.plugin === 'check' && setting.definition.id === id)?.definition.default,
      onChange: () => () => {},
    },
  };
  try {
    if (entry.apiVersion !== undefined && entry.apiVersion !== 1) throw new Error(`unsupported viewer API ${entry.apiVersion}`);
    const generic: Array<{ slot: string; descriptor: { id: string; render(context: unknown): unknown } }> = [];
    const api = registry.apiFor('check');
    const register = api.registerSlotItem;
    api.registerSlotItem = (slot, descriptor) => {
      register(slot, descriptor);
      generic.push({ slot, descriptor: descriptor as { id: string; render(context: unknown): unknown } });
    };
    await entry(api);
    const page = registry.pages.get('check');
    if (page) {
      const host = document.createElement('section');
      host.dataset.slot = 'pages';
      host.dataset.slotItem = 'plugin:check:page';
      document.body.append(host);
      const loadContext = { path: '', search: {}, signal: new AbortController().signal };
      try {
        const data = await page.loader?.(loadContext);
        const cleanup = page.render(host, {
          ...context,
          ...loadContext,
          data,
          navigate: (path) => {
            output.push(`navigate ${path}`);
          },
        });
        output.push(`pages plugin:check:page: ${host.textContent?.slice(0, 1000) ?? ''}`);
        if (typeof cleanup === 'function') cleanup();
      } catch (error) {
        errors.push(`plugin:check:page: ${String(error)}`);
      }
    }
    for (const { slot, descriptor } of generic) {
      if (!registry.resolveSlot(slot, [], context).some((item) => item.id === descriptor.id)) continue;
      output.push(`${slot} ${descriptor.id}`);
      try {
        output.push(`${descriptor.id}: ${String(await descriptor.render(context))}`);
      } catch (error) {
        errors.push(`${descriptor.id}: ${String(error)}`);
      }
    }
    const snapshot = registry.getSnapshot();
    for (const [kind, entries] of Object.entries(snapshot)) {
      for (const registered of entries) {
        const definition = registered.definition;
        output.push(`${kind} ${registered.key}`);
        const host = document.createElement('section');
        host.dataset.slot = kind;
        host.dataset.slotItem = registered.key;
        document.body.append(host);
        try {
          let cleanup: unknown;
          if ('render' in definition) {
            const render = definition.render as (container: HTMLElement, ctx: unknown) => unknown;
            cleanup = await render(
              host,
              kind === 'columns'
                ? {
                    ...context,
                    summary: { ...replay.meta, steps: replay.steps.length, console: replay.console.length, network: replay.network.length },
                  }
                : kind === 'sections'
                  ? { ...context, summaries: [] }
                  : context,
            );
            output.push(`${registered.key}: ${host.textContent?.slice(0, 1000) ?? ''}`);
          } else if ('run' in definition && definition.when?.(context) !== false) await definition.run(context);
          else if ('markers' in definition) output.push(`${registered.key}: ${JSON.stringify(await definition.markers(context))}`);
          if (typeof cleanup === 'function') cleanup();
        } catch (error) {
          errors.push(`${registered.key}: ${String(error)}`);
        }
      }
    }
  } catch (error) {
    errors.push(String(error));
  }
  Object.assign(window, { __pluginCheck: { output, errors, done: true } });
}

/** Uses the real CSP sandbox page and MessagePort protocol; fixture writes are reported, never sent to a server. */
export async function checkUserPlugin(file: UserPluginFile) {
  const output: string[] = [];
  const errors: string[] = [];
  const replay = (await (await fetch('/fixture.json')).json()) as ReplayBundle;
  const settings = Object.fromEntries((file.manifest.settings ?? []).map((setting) => [setting.id, setting.default]));
  for (const [kind, entries] of Object.entries(file.manifest.contributes)) {
    const mode = kind === 'tabs' ? 'tab' : kind === 'panels' ? 'panel' : 'action';
    for (const contribution of entries) {
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.src = '/_malleable/sandbox.html';
      document.body.append(iframe);
      await new Promise<void>((resolve) => {
        let port: MessagePort | undefined;
        const finish = () => {
          clearTimeout(timer);
          window.removeEventListener('message', ready);
          port?.close();
          if (mode === 'action') iframe.remove();
          resolve();
        };
        const timer = setTimeout(() => {
          errors.push(`${mode}:${contribution.id}: timed out after 3 seconds`);
          finish();
        }, 3000);
        const ready = (event: MessageEvent) => {
          if (event.source !== iframe.contentWindow || event.data?.replaysSandbox !== 'ready') return;
          window.removeEventListener('message', ready);
          const channel = new MessageChannel();
          port = channel.port1;
          port.addEventListener('message', (message: MessageEvent) => {
            const { id, method, params = {} } = message.data as { id: number; method: string; params?: Record<string, unknown> };
            if (method === 'error') {
              errors.push(`${mode}:${contribution.id}: ${String(params.message)}`);
              finish();
              return;
            }
            if (method === 'log') {
              output.push(`${mode}:${contribution.id}: ${String(params.message)}`);
              return;
            }
            if (method === 'done' || method === 'rendered') {
              output.push(`${mode}:${contribution.id}: completed`);
              finish();
              return;
            }
            if (method === 'heartbeat') return;
            let result: unknown = null;
            let error: string | undefined;
            const capability = (
              {
                seek: 'playback:seek',
                notify: 'notify',
                'comments.list': 'comments:read',
                'comments.add': 'comments:write',
                download: 'export:download',
              } as Record<string, string>
            )[method];
            if (capability && !file.manifest.permissions.includes(capability as never)) error = `permission-denied: ${capability}`;
            else if (method.startsWith('settings.')) {
              const definition = file.manifest.settings?.find((setting) => setting.id === params.id);
              if (!definition) error = 'unknown setting';
              else if (method === 'settings.get') result = settings[definition.id];
              else if (
                method === 'settings.set' &&
                (definition.type === 'boolean'
                  ? typeof params.value === 'boolean'
                  : definition.options.some((option) => option.value === params.value))
              ) {
                settings[definition.id] = params.value as boolean | string;
                result = params.value;
              } else error = 'invalid setting value';
            } else if (method === 'comments.list') result = [];
            else if (method === 'comments.add') {
              output.push(`fixture comment: ${String(params.body)}`);
              result = { id: 'fixture-comment' };
            } else if (method === 'download') output.push(`fixture download: ${String(params.name)} ${String(params.text).slice(0, 2000)}`);
            else if (method === 'notify') output.push(`notify: ${String(params.message)}`);
            else if (method === 'seek') output.push(`seek: ${String(params.ms)}`);
            else error = `unknown method ${method}`;
            port?.postMessage(error ? { id, ok: false, error } : { id, ok: true, result });
          });
          port.start();
          iframe.contentWindow?.postMessage(
            {
              type: 'init',
              mode,
              contribution: contribution.id,
              source: file.source,
              theme: 'dark',
              vars: {},
              time: 0,
              ...(file.manifest.permissions.includes('replay:read') ? { replay: { ...replay, events: undefined } } : {}),
            },
            '*',
            [channel.port2],
          );
        };
        window.addEventListener('message', ready);
      });
    }
  }
  Object.assign(window, { __pluginCheck: { output, errors, done: true } });
}
