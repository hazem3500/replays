import { useMemo, useState } from 'react';

import { diffLines } from '../../shared/line-diff.ts';
import { CAPABILITIES, isWriteCapability } from '../../shared/malleable.ts';
import { notify } from '../toast.ts';
import { DiffView } from './DiffView.tsx';
import { latestSaved, manager, useManager } from './manager.ts';
import { Modal } from './Modal.tsx';
import { setMalleableUi, useMalleableUi } from './ui-state.ts';

const ORIGIN_TEXT = { agent: 'Written by an agent', workshop: 'Written in the editor', saved: 'Loaded from your saved plugins' } as const;

/**
 * The approval dialog: the only way a plugin is stored. It shows who wrote the working copy, what it may do, and exactly what
 * changes; "Approve & save" is the click that lets the viewer ask the server for a consent token (manager.saveApproved).
 */
export function KeepDialog() {
  const { keepFor } = useMalleableUi();
  const { entries } = useManager();
  const entry = entries.find((candidate) => candidate.id === keepFor);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const saved = entry ? latestSaved(entry) : undefined;
  const diff = useMemo(() => (entry ? diffLines(saved?.source ?? '', entry.source) : []), [entry, saved]);
  if (!entry) return null;
  const close = () => {
    setMalleableUi({ keepFor: undefined });
    setError(undefined);
    setMessage('');
  };
  const manifestChanged = !saved || JSON.stringify(saved.manifest) !== JSON.stringify(entry.manifest);
  return (
    <Modal title={`Keep “${entry.manifest.name}”?`} wide testId="keep-dialog" onClose={close}>
      <p className="mall-lead">
        {ORIGIN_TEXT[entry.origin]}. Nothing is stored until you approve.{' '}
        {saved ? `This becomes version ${saved.n + 1}.` : 'This is its first version.'}
      </p>
      <section className="mall-section">
        <h3>What it can do</h3>
        <ul className="mall-perms" data-testid="keep-permissions">
          {entry.manifest.permissions.length === 0 ? <li>Nothing beyond drawing its own panel (it cannot read the replay).</li> : null}
          {entry.manifest.permissions.map((permission) => (
            <li key={permission} data-write={isWriteCapability(permission)}>
              <code>{permission}</code> {CAPABILITIES[permission].label}
              {isWriteCapability(permission) ? <em> — asks you each time it runs</em> : null}
            </li>
          ))}
        </ul>
        <p className="mall-note">It runs in a sandbox with no network access. It can only use the list above.</p>
      </section>
      {!entry.versions.length ? (
        <section className="mall-section">
          <h3>Who gets it</h3>
          <select
            className="mall-input"
            aria-label="Who gets this plugin"
            data-testid="keep-scope"
            value={entry.scope}
            onChange={(event) => manager.setScope(entry.id, event.target.value as 'user' | 'workspace')}
          >
            <option value="user">Only me</option>
            <option value="workspace">Everyone in this workspace</option>
          </select>
        </section>
      ) : null}
      <section className="mall-section">
        <h3>{saved ? `Changes since version ${saved.n}` : 'Source'}</h3>
        {manifestChanged && saved ? <p className="mall-note">The manifest changed too (name, permissions or contributions).</p> : null}
        <DiffView diff={diff} testId="keep-diff" />
      </section>
      <label className="mall-field">
        <span>Note for the history (optional)</span>
        <input
          className="mall-input"
          value={message}
          maxLength={200}
          data-testid="keep-message"
          onChange={(event) => setMessage(event.target.value)}
        />
      </label>
      {error ? (
        <p className="mall-error" role="alert" data-testid="keep-error">
          {error}
        </p>
      ) : null}
      <div className="mall-actions">
        <button type="button" className="mall-btn" data-testid="keep-cancel" data-autofocus onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="mall-btn mall-btn-primary"
          data-testid="keep-approve"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(undefined);
            manager
              .saveApproved(entry.id, message)
              .then(() => {
                notify(`Saved “${entry.manifest.name}”`);
                close();
              })
              .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
              .finally(() => setBusy(false));
          }}
        >
          Approve &amp; save
        </button>
      </div>
    </Modal>
  );
}
