import {
  CircleAlertIcon,
  CircleSlashIcon,
  type LucideIcon,
  FilterIcon,
  FolderOpenIcon,
  GaugeIcon,
  GitCompareIcon,
  InboxIcon,
  ListOrderedIcon,
  MessageSquareIcon,
  NetworkIcon,
  SearchIcon,
  SparklesIcon,
  TerminalIcon,
  UploadIcon,
  WifiOffIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button.tsx';
import { cn } from '@/lib/utils.ts';
import './empty-state.css';

export const emptyStateStrings = {
  retryIn: (seconds: number) => `Retrying in ${seconds}s`,
  retrying: 'Retrying…',
  activeLabel: 'Active',
} as const;

const ICONS = {
  alert: CircleAlertIcon,
  comment: MessageSquareIcon,
  compare: GitCompareIcon,
  console: TerminalIcon,
  filter: FilterIcon,
  folder: FolderOpenIcon,
  inbox: InboxIcon,
  network: NetworkIcon,
  none: CircleSlashIcon,
  offline: WifiOffIcon,
  performance: GaugeIcon,
  search: SearchIcon,
  sparkles: SparklesIcon,
  steps: ListOrderedIcon,
  upload: UploadIcon,
} satisfies Record<string, LucideIcon>;

export type EmptyStateIcon = keyof typeof ICONS;
export type EmptyStateTone = 'empty' | 'error' | 'offline';
/** `region`: centred in a page or large area. `compact`: left-aligned in a panel. `banner`: one line above content still shown. */
export type EmptyStateVariant = 'region' | 'compact' | 'banner';

export type EmptyStateAction = {
  id: string;
  label: string;
  /** The one action that moves the person forward; at most one per state. */
  primary?: boolean;
  disabled?: boolean;
} & ({ onSelect: () => void; href?: never } | { href: string; onSelect?: never; external?: boolean });

export interface EmptyStateProps {
  title: string;
  body?: string;
  /** An icon name, or `null` for none. Defaults by tone: inbox, alert, offline. */
  icon?: EmptyStateIcon | null;
  tone?: EmptyStateTone;
  variant?: EmptyStateVariant;
  actions?: readonly EmptyStateAction[];
  /** What is narrowing the view ("Host demo.example", "Has errors"), listed under the body. */
  chips?: readonly string[];
  chipsLabel?: string;
  /** A quiet status line, e.g. the auto-retry countdown (`emptyStateStrings.retryIn`). */
  status?: string;
  className?: string;
  testId?: string;
}

const DEFAULT_ICON: Record<EmptyStateTone, EmptyStateIcon> = { empty: 'inbox', error: 'alert', offline: 'offline' };

/**
 * One empty/error state for every surface. Props are plain data (strings, an icon name, action descriptors), so a
 * plugin or a slot descriptor can describe one without React. Copy comes from each surface's strings module.
 */
export function EmptyState({
  title,
  body,
  icon,
  tone = 'empty',
  variant = 'region',
  actions = [],
  chips = [],
  chipsLabel = emptyStateStrings.activeLabel,
  status,
  className,
  testId,
}: EmptyStateProps) {
  const name = icon === undefined ? DEFAULT_ICON[tone] : icon;
  const Icon = name ? ICONS[name] : undefined;
  // why: an error replaces what the person asked for, so it is announced; an offline banner or an empty list is not urgent.
  const role = tone === 'error' ? 'alert' : tone === 'offline' ? 'status' : undefined;
  return (
    <div className={cn('empty-state', className)} data-tone={tone} data-variant={variant} role={role} data-testid={testId}>
      {Icon ? (
        <span className="empty-state-icon" aria-hidden="true">
          <Icon />
        </span>
      ) : null}
      <div className="empty-state-text">
        <p className="empty-state-title">{title}</p>
        {body ? <p className="empty-state-body">{body}</p> : null}
        {chips.length ? (
          <ul className="empty-state-chips" aria-label={chipsLabel}>
            {chips.map((chip) => (
              <li key={chip}>{chip}</li>
            ))}
          </ul>
        ) : null}
        {status ? <p className="empty-state-status">{status}</p> : null}
      </div>
      {actions.length ? (
        <div className="empty-state-actions">
          {actions.map((action) => (
            <EmptyStateButton key={action.id} action={action} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EmptyStateButton({ action }: { action: EmptyStateAction }) {
  const common = {
    variant: action.primary ? 'default' : 'outline',
    size: 'lg',
    className: 'empty-state-action',
    'data-primary': action.primary || undefined,
    'data-action-id': action.id,
    disabled: action.disabled,
  } as const;
  if (action.href !== undefined) {
    const external = 'external' in action && action.external;
    return (
      <Button
        {...common}
        nativeButton={false}
        render={<a href={action.href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})} />}
      >
        {action.label}
      </Button>
    );
  }
  return (
    <Button {...common} type="button" onClick={action.onSelect}>
      {action.label}
    </Button>
  );
}
