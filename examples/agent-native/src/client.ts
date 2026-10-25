import { defineViewerPlugin } from '@hazem3500/replays/viewer';
import { createFrameworkClient } from './webmcp-client.ts';

export default defineViewerPlugin((api) => {
  api.registerInspectorTab({
    id: 'tools',
    label: 'Agent-Native',
    render(container) {
      let client: ReturnType<typeof createFrameworkClient>;
      const abort = new AbortController();
      let live = true;
      let listing = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let off: (() => void) | undefined;
      let deadline = 0;
      let executing = false;
      const note = document.createElement('p');
      note.textContent = 'Agent-Native browser client → existing Replays tools. Drafts require a human Keep.';
      const form = document.createElement('form');
      const select = document.createElement('select');
      select.setAttribute('aria-label', 'Replays tool');
      const input = document.createElement('textarea');
      input.setAttribute('aria-label', 'Tool arguments (JSON object)');
      input.value = '{}';
      input.rows = 5;
      const run = document.createElement('button');
      run.type = 'submit';
      run.textContent = 'Run tool';
      run.disabled = true;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Retry discovery';
      const output = document.createElement('pre');
      output.setAttribute('aria-live', 'polite');
      output.style.whiteSpace = 'pre-wrap';
      output.style.overflowWrap = 'anywhere';
      form.append(select, input, run);
      container.append(note, form, retry, output);
      const refresh = async () => {
        clearTimeout(timer);
        const generation = ++listing;
        try {
          client ??= createFrameworkClient(document);
          if (!client) throw new Error('Waiting for Replays WebMCP initialization');
          off ??= client.onToolChange?.(() => {
            void refresh();
          });
          const tools = await client.listTools();
          if (!live || generation !== listing) return;
          if (tools.length === 0) throw new Error('Waiting for Replays tools to register');
          const selected = select.value;
          select.replaceChildren(
            ...tools.map((tool) => {
              const option = document.createElement('option');
              option.value = tool.name;
              option.textContent = tool.name;
              option.title = tool.description;
              return option;
            }),
          );
          select.value = tools.some((tool) => tool.name === selected) ? selected : 'get_app_state';
          run.disabled = executing;
          output.textContent = `${tools.length} tools discovered`;
        } catch (error) {
          if (!live || generation !== listing) return;
          run.disabled = true;
          output.textContent = `${String(error)}. Use Retry discovery if initialization is still pending.`;
          if (Date.now() < deadline) timer = setTimeout(() => void refresh(), 200);
        }
      };
      const discover = () => {
        deadline = Date.now() + 8000;
        void refresh();
      };
      retry.addEventListener('click', discover, { signal: abort.signal });
      form.addEventListener(
        'submit',
        (event) => {
          event.preventDefault();
          if (!client || executing) return;
          const activeClient = client;
          executing = true;
          run.disabled = true;
          void (async () => {
            try {
              // The framework re-lists before executing, preserving native descriptor identity.
              const result = await activeClient.executeTool({ name: select.value }, JSON.parse(input.value), { signal: abort.signal });
              if (live) output.textContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            } catch (error) {
              if (live) output.textContent = String(error);
            } finally {
              executing = false;
              if (live) run.disabled = false;
            }
          })();
        },
        { signal: abort.signal },
      );
      discover();
      return () => {
        live = false;
        clearTimeout(timer);
        abort.abort();
        off?.();
      };
    },
  });
});
