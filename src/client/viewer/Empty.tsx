import type { ReactNode } from 'react';

/** A compact, intentional empty state: what is missing, why, and (optionally) the one useful next step. */
export function Empty({ title, children, action }: { title: string; children: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <span>{children}</span>
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}
