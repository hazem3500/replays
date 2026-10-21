import { useEffect, useMemo, useRef, useState } from 'react';

import type { ReplaySummary } from '../../shared/replay.ts';
import type { Cleanup, IndexColumnContext, IndexPerson, IndexPluginContext, IndexSectionContext } from '../plugins/api.ts';
import { PluginMount, showPluginError, usePluginSnapshot } from '../plugins/PluginUi.tsx';
import type { Snapshot } from '../plugins/registry.ts';
import { apiUrl, appBase } from '../route.ts';

/*
 * The index's plugin slots (`registerIndexColumn`, `registerIndexSection`; filters live in FilterMenu.tsx). Client entries
 * load on every page (main.tsx), so these appear once the entries have run; a slot that throws shows an error line and
 * logs, like a failing inspector tab, and never takes the list down with it.
 */

function indexContext(): IndexPluginContext {
  return {
    get theme() {
      return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    },
    basePath: appBase(),
    apiUrl: (path) => apiUrl(path),
  };
}

/** One replay row's plugin fields (list rows and grid cards); nothing when no plugin registered a column. */
export function IndexColumns({ summary }: { summary: ReplaySummary }) {
  const { columns } = usePluginSnapshot();
  const context = useMemo<IndexColumnContext>(() => Object.assign(indexContext(), { summary }), [summary]);
  if (!columns.length) return null;
  return (
    <span className="feed-ext">
      {columns.map((column) => (
        <PluginMount
          key={column.key}
          inline
          render={column.definition.render}
          context={context}
          label={column.definition.label}
          className="feed-ext-field"
          testId={`plugin-column:${column.plugin}:${column.definition.id}`}
        />
      ))}
    </span>
  );
}

/** `GET /api/me`, once, for the sections' `me`; undefined until it answers (or when it cannot). */
function useMe(enabled: boolean) {
  const [me, setMe] = useState<IndexPerson>();
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch(apiUrl('me'), { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<unknown>) : undefined))
      .then((value) => {
        const person = value as IndexPerson | undefined;
        if (typeof person?.id === 'string') setMe(person);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [enabled]);
  return me;
}

type SectionEntry = Snapshot['sections'][number];

/**
 * One section: rendered once, then `update(container, context)` on every change of the list, or (without `update`)
 * cleaned up and rendered again.
 */
function SectionMount({ entry, context }: { entry: SectionEntry; context: IndexSectionContext }) {
  const { definition } = entry;
  const host = useRef<HTMLDivElement>(null);
  const mounted = useRef<{ cleanup: Cleanup } | undefined>(undefined);
  const runCleanup = () => {
    const cleanup = mounted.current?.cleanup;
    mounted.current = undefined;
    try {
      if (typeof cleanup === 'function') cleanup();
    } catch (error) {
      console.error(`plugin view "${definition.title}" cleanup failed:`, error);
    }
  };
  useEffect(() => {
    const container = host.current;
    return () => {
      runCleanup();
      container?.replaceChildren();
    };
    // oxlint-disable-next-line react/exhaustive-deps -- per definition: a new one starts from a fresh render.
  }, [definition]);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    try {
      if (mounted.current && definition.update) {
        definition.update(container, context);
        return;
      }
      runCleanup();
      container.replaceChildren();
      delete container.dataset.pluginError;
      mounted.current = { cleanup: definition.render(container, context) };
    } catch (error) {
      runCleanup();
      showPluginError(container, definition.title, error);
    }
    // oxlint-disable-next-line react/exhaustive-deps -- runCleanup only reads the ref.
  }, [definition, context]);
  return (
    <section className="index-section" aria-label={definition.title} data-testid={`plugin-section:${entry.plugin}:${definition.id}`}>
      <h2 className="index-section-title">{definition.title}</h2>
      <div ref={host} className="index-section-body" />
    </section>
  );
}

/** The plugins' blocks above the list, given every replay the list shows now. */
export function IndexSections({ summaries }: { summaries: readonly ReplaySummary[] }) {
  const { sections } = usePluginSnapshot();
  const me = useMe(sections.length > 0);
  const context = useMemo<IndexSectionContext>(() => Object.assign(indexContext(), { summaries, ...(me ? { me } : {}) }), [summaries, me]);
  if (!sections.length) return null;
  return (
    <div className="index-sections">
      {sections.map((entry) => (
        <SectionMount key={entry.key} entry={entry} context={context} />
      ))}
    </div>
  );
}
