import { permissions, usePermissionRequests } from './broker.ts';
import { Modal } from './Modal.tsx';

/** The question a sandboxed plugin triggers when it first tries something beyond reading. One at a time, oldest first. */
export function PermissionPrompt() {
  const requests = usePermissionRequests();
  const request = requests[0];
  if (!request) return null;
  return (
    <Modal
      title="A plugin wants to make a change"
      role="alertdialog"
      testId="permission-prompt"
      onClose={() => permissions.decide(request.key, 'deny')}
    >
      <p className="mall-lead" data-testid="permission-detail">
        {request.detail}
      </p>
      {request.preview ? (
        <pre className="mall-preview" data-testid="permission-preview">
          {request.preview}
        </pre>
      ) : null}
      <p className="mall-note">
        Permission: <strong>{request.capability}</strong> — {request.label}.
        {requests.length > 1 ? ` ${requests.length - 1} more waiting.` : ''}
      </p>
      <div className="mall-actions">
        <button
          type="button"
          className="mall-btn"
          data-testid="permission-deny"
          data-autofocus
          onClick={() => permissions.decide(request.key, 'deny')}
        >
          Deny
        </button>
        <button
          type="button"
          className="mall-btn"
          data-testid="permission-allow-once"
          onClick={() => permissions.decide(request.key, 'once')}
        >
          Allow this once
        </button>
        <button
          type="button"
          className="mall-btn mall-btn-primary"
          data-testid="permission-allow-session"
          onClick={() => permissions.decide(request.key, 'session')}
        >
          Allow until I reload
        </button>
      </div>
    </Modal>
  );
}
