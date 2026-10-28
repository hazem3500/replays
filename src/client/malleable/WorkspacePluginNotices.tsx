import { useState } from 'react';
import { latestSaved, manager, useManager } from './manager.ts';
import { setMalleableUi } from './ui-state.ts';

/** Persisted per-person acceptance gates execution; a dismiss keeps the plugin disabled. */
export function WorkspacePluginNotices() {
  const { entries, disabled } = useManager();
  const pending = entries.filter((entry) => entry.needsAcceptance && !disabled.includes(entry.id));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<string>();
  if (!pending.length) return null;
  return (
    <aside className="mall-workspace-notices" aria-label="Workspace plugin notices" data-testid="workspace-plugin-notices">
      {pending.map((entry) => (
        <section key={entry.id} data-testid={`workspace-plugin-notice:${entry.id}`}>
          <p>
            New workspace plugin from {latestSaved(entry)?.by ?? 'a workspace administrator'}: <strong>{entry.manifest.name}</strong>
          </p>
          <p>{entry.manifest.description}</p>
          <p>Permissions: {entry.manifest.permissions.join(', ') || 'none'}</p>
          <div className="mall-actions">
            <button type="button" onClick={() => setMalleableUi({ workshopOpen: true, workshopPlugin: entry.id })}>
              Review source
            </button>
            <button
              type="button"
              disabled={saving === entry.id}
              onClick={() => {
                setSaving(entry.id);
                setError('');
                void manager
                  .acceptWorkspace(entry.id)
                  .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
                  .finally(() => setSaving(undefined));
              }}
            >
              Enable this version
            </button>
            <button type="button" onClick={() => manager.setEnabled(entry.id, false)}>
              Keep disabled
            </button>
          </div>
        </section>
      ))}
      {error ? <p role="alert">{error}</p> : null}
    </aside>
  );
}
