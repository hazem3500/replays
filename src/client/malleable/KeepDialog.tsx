import { useEffect, useMemo, useRef, useState } from 'react';

import { diffLines } from '../../shared/line-diff.ts';
import { CAPABILITIES, isWriteCapability } from '../../shared/malleable.ts';
import { capabilityRule, policyProblems } from '../../shared/malleable-policy.ts';
import { notify } from '../toast.ts';
import { createDraftApproval } from './approval-machine.ts';
import { DiffView } from './DiffView.tsx';
import { useHost } from './host.ts';
import { latestSaved, manager, sameManifest, useManager } from './manager.ts';
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
  const { policy } = useHost();
  const entry = entries.find((candidate) => candidate.id === keepFor);
  const [message, setMessage] = useState('');
  const actor = useRef<ReturnType<typeof createDraftApproval> | undefined>(undefined);
  const [approval, setApproval] = useState<ReturnType<ReturnType<typeof createDraftApproval>['getSnapshot']>>();
  const id = entry?.id;
  const revision = entry?.revision;
  useEffect(() => {
    if (id === undefined || revision === undefined) return;
    const session = createDraftApproval(revision, (reviewedRevision, note, signal) =>
      manager.saveApproved(id, note, { revision: reviewedRevision, signal }),
    );
    actor.current = session;
    const subscription = session.subscribe((snapshot) => {
      setApproval(snapshot);
      if (snapshot.matches('saved')) {
        notify(`Saved “${manager.get(id)?.manifest.name ?? id}”`);
        setMalleableUi({ keepFor: undefined });
        setMessage('');
      }
    });
    session.start();
    session.send({ type: 'requestKeep' });
    return () => {
      subscription.unsubscribe();
      session.stop();
      actor.current = undefined;
    };
  }, [actor, id, revision]);
  const busy = approval?.matches('saving') ?? false;
  const error = approval?.context.error;
  const saved = entry ? latestSaved(entry) : undefined;
  const diff = useMemo(() => (entry ? diffLines(saved?.source ?? '', entry.source) : []), [entry, saved]);
  if (!entry) return null;
  const close = () => {
    setMalleableUi({ keepFor: undefined });
    actor.current?.send({ type: 'cancel' });
    setMessage('');
  };
  const manifestChanged = !saved || !sameManifest(saved.manifest, entry.manifest);
  // The host's policy decides before the person does: the server would refuse these anyway (403).
  const problems = policyProblems(policy, entry.manifest, entry.scope);
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
              {capabilityRule(policy, permission) === 'deny' ? (
                <em> (not allowed on this server)</em>
              ) : isWriteCapability(permission) || capabilityRule(policy, permission) === 'ask' ? (
                <em> (asks you each time it runs)</em>
              ) : null}
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
            {policy.scopes.includes('user') || entry.scope === 'user' ? <option value="user">Only me</option> : null}
            {policy.scopes.includes('workspace') || entry.scope === 'workspace' ? (
              <option value="workspace">Everyone in this workspace</option>
            ) : null}
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
      {problems.length ? (
        <p className="mall-error" role="alert" data-testid="keep-policy">
          This server will not keep it: {problems.join('; ')}.
        </p>
      ) : null}
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
          disabled={busy || problems.length > 0}
          onClick={() => {
            actor.current?.send({ type: 'approve', revision: entry.revision, message, human: true });
          }}
        >
          Approve &amp; save
        </button>
      </div>
    </Modal>
  );
}
