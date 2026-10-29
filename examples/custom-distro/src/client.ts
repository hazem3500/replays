import { defineViewerPlugin } from '@hazem3500/replays/viewer';

type Listed = { ext?: Record<string, Record<string, unknown>> };

/** What the server plugin's summaryFields derived for one replay. */
const ext = (summary: Listed) => summary.ext?.['acme-distro'] ?? {};

/** The "Uploaded by you" line. */
function countMine(container: HTMLElement, summaries: readonly Listed[], me?: { id: string }) {
  const mine = me ? summaries.filter((summary) => ext(summary).uploadedBy === me.id).length : 0;
  container.textContent = `${mine} of ${summaries.length} listed replays are yours`;
}

// Plugin icons are image URLs (a data:image/svg+xml URL or https), drawn as <img>, never inlined as markup.
const JUMP_ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#8d94a4" stroke-width="1.6" stroke-linecap="round"><path d="M4 3v10M12 3 6 8l6 5"/></svg>',
)}`;

export default defineViewerPlugin((api) => {
  api.registerExportFormat({
    id: 'console-json',
    label: 'Console JSON',
    run: ({ replay }) => ({
      name: `${replay.meta.id}-console.json`,
      mime: 'application/json',
      data: JSON.stringify(replay.console),
    }),
  });
  api.registerShortcut({ id: 'hello', label: 'Acme hello', keys: ['g'], run: ({ notify }) => notify('Acme shortcut ran') });
  api.registerEditorTool({
    id: 'note',
    label: 'Mark for Acme',
    run: ({ edits, duration, getTime }) => {
      const from = Math.max(0, Math.min(getTime(), duration - 1000));
      return {
        ...edits,
        captions: [
          ...(edits.captions ?? []),
          { id: crypto.randomUUID(), from, to: Math.min(duration, from + 1000), text: 'Review this moment' },
        ],
      };
    },
  });
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
    render(container, { replay, onTime, getTime, settings }) {
      const heading = document.createElement('p');
      heading.textContent = `Notes for ${replay.meta.title}`;
      const clock = document.createElement('p');
      clock.dataset.testid = 'acme-clock';
      container.append(heading, clock);
      // The `units` setting (below) decides how the clock reads, and redraws it when the person changes it.
      const draw = (ms: number) => {
        clock.textContent = settings.get('units') === 'ms' ? `${Math.round(ms)} ms` : `${Math.round(ms / 1000)} s`;
      };
      draw(getTime());
      const offTime = onTime(draw);
      const offSettings = settings.onChange(() => draw(getTime()));
      return () => {
        offTime();
        offSettings();
      };
    },
  });

  // A bar action: an icon button in the viewer header (phones keep it in More).
  api.registerViewerAction({
    id: 'jump-start',
    label: 'Back to the start (Acme)',
    placement: 'bar',
    icon: JUMP_ICON,
    run({ seek, notify }) {
      seek(0);
      notify('Back at 0:00');
    },
  });

  // A timeline track: the replay's console errors and warnings as marks under the seek bar; a click seeks there.
  api.registerTimelineTrack({
    id: 'console-problems',
    label: 'Console problems',
    markers: ({ replay }) =>
      replay.console
        .filter((entry) => entry.level === 'error' || entry.level === 'warn')
        .map((entry) => ({ atMs: entry.at, label: entry.message, tone: entry.level === 'error' ? ('error' as const) : ('warn' as const) })),
  });

  // A block inside the built-in Context tab, which follows the `compact` setting.
  api.registerContextSection({
    id: 'release',
    title: 'Acme release',
    render(container, { replay, settings }) {
      const line = document.createElement('p');
      line.dataset.testid = 'acme-release';
      const draw = () => {
        const environment = String(replay.context?.fields?.environment ?? 'unknown');
        line.textContent = settings.get('compact') ? environment : `Released to ${environment}, recorded ${replay.meta.capturedAt}`;
      };
      draw();
      container.append(line);
      return settings.onChange(draw);
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

  // Per-person settings, in the More menu: stored in this browser, read with `context.settings`.
  api.registerSetting({ id: 'compact', label: 'Compact Acme release', type: 'boolean', default: false });
  api.registerSetting({
    id: 'units',
    label: 'Acme clock',
    type: 'choice',
    options: [
      { value: 's', label: 'Seconds' },
      { value: 'ms', label: 'Milliseconds' },
    ],
    default: 's',
  });
});
