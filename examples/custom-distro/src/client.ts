import { defineViewerPlugin } from '@hazem3500/replays/viewer';

type Listed = { ext?: Record<string, Record<string, unknown>> };

/** What the server plugin's summaryFields derived for one replay. */
const ext = (summary: Listed) => summary.ext?.['acme-distro'] ?? {};

/** The "Uploaded by you" line. */
function countMine(container: HTMLElement, summaries: readonly Listed[], me?: { id: string }) {
  const mine = me ? summaries.filter((summary) => ext(summary).uploadedBy === me.id).length : 0;
  container.textContent = `${mine} of ${summaries.length} listed replays are yours`;
}

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

  // The index. Columns and sections read what the server plugin's summaryFields put in summary.ext['acme-distro'].
  api.registerIndexColumn({
    id: 'environment',
    label: 'Environment',
    render(container, { summary }) {
      const environment = ext(summary).environment;
      container.textContent = typeof environment === 'string' ? `env ${environment}` : '';
    },
  });

  // The server's indexFilter with the same param does the matching.
  api.registerIndexFilter({
    id: 'environment',
    label: 'Environment',
    type: 'choice',
    param: 'x-env',
    options: [
      { value: 'staging', label: 'Staging' },
      { value: 'production', label: 'Production' },
    ],
  });

  // "Uploaded by you": re-drawn in place (update) whenever the list or the signed-in person changes.
  api.registerIndexSection({
    id: 'mine',
    title: 'Uploaded by you',
    render: (container, { summaries, me }) => countMine(container, summaries, me),
    update: (container, { summaries, me }) => countMine(container, summaries, me),
  });
});
