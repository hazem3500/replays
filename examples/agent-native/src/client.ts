import { createAgentNativeWebMcpClient } from '@agent-native/core/client/webmcp';
import { defineViewerPlugin } from '@hazem3500/replays/viewer';

export default defineViewerPlugin((api) => {
  api.registerInspectorTab({
    id: 'tools',
    label: 'Agent-Native',
    render(container) {
      // Supplying document consumes Replays' existing context: no second polyfill or duplicate registrations.
      const client = createAgentNativeWebMcpClient({ document });
      const abort = new AbortController();
      let live = true;
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
      const output = document.createElement('pre');
      output.setAttribute('aria-live', 'polite');
      output.style.whiteSpace = 'pre-wrap';
      output.style.overflowWrap = 'anywhere';
      form.append(select, input, run);
      container.append(note, form, output);
      const refresh = async () => {
        try {
          const tools = await client.listTools();
          if (!live) return;
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
          run.disabled = tools.length === 0;
          output.textContent = `${tools.length} tools discovered`;
        } catch (error) {
          if (live) output.textContent = String(error);
        }
      };
      form.addEventListener(
        'submit',
        (event) => {
          event.preventDefault();
          run.disabled = true;
          void (async () => {
            try {
              // The framework re-lists before executing, preserving native descriptor identity.
              const result = await client.executeTool({ name: select.value }, JSON.parse(input.value), { signal: abort.signal });
              if (live) output.textContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            } catch (error) {
              if (live) output.textContent = String(error);
            } finally {
              if (live) run.disabled = false;
            }
          })();
        },
        { signal: abort.signal },
      );
      const off = client.onToolChange?.(() => {
        void refresh();
      });
      void refresh();
      return () => {
        live = false;
        abort.abort();
        off?.();
      };
    },
  });
});
