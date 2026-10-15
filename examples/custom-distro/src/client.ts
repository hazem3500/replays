import { defineViewerPlugin } from '@hazem3500/replays/viewer';

export default defineViewerPlugin((api) => {
  api.registerInspectorTab({
    id: 'build',
    label: 'Acme build',
    render(container, { replay, theme }) {
      const fields = replay.context?.fields ?? {};
      container.dataset.theme = theme;
      container.innerHTML = '';
      const list = document.createElement('dl');
      for (const [term, value] of [
        ['Replay', replay.meta.title],
        ['Environment', String(fields.environment ?? 'unknown')],
      ] as const) {
        const dt = document.createElement('dt');
        dt.textContent = term;
        const dd = document.createElement('dd');
        dd.textContent = value;
        list.append(dt, dd);
      }
      container.append(list);
    },
  });

  api.registerViewerAction({
    id: 'copy-summary',
    label: 'Copy Acme summary',
    run({ replay, notify }) {
      void navigator.clipboard?.writeText(`${replay.meta.title} (${replay.meta.id})`).catch(() => undefined);
      notify('Acme summary copied');
    },
  });

  api.registerViewerPanel({
    id: 'notes',
    title: 'Acme notes',
    render(container, { replay, onTime }) {
      const heading = document.createElement('p');
      heading.textContent = `Notes for ${replay.meta.title}`;
      const clock = document.createElement('p');
      clock.dataset.testid = 'acme-clock';
      container.append(heading, clock);
      return onTime((ms) => {
        clock.textContent = `${Math.round(ms / 1000)} s`;
      });
    },
  });
});
