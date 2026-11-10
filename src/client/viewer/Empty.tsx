import { InboxIcon, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** A quiet empty state: a small icon, what is missing in one sentence, and (optionally) the one useful next step. Never a skeleton. */
export function Empty({
  title,
  children,
  action,
  icon: Icon = InboxIcon,
}: {
  title: string;
  children: string;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="empty">
      <Icon className="empty-icon" aria-hidden="true" />
      <strong>{title}</strong>
      <span>{children}</span>
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}
