import {
  CircleAlertIcon,
  FilterIcon,
  FolderOpenIcon,
  InboxIcon,
  type LucideIcon,
  SearchIcon,
  SparklesIcon,
  WifiOffIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button.tsx';

const ICONS = {
  alert: CircleAlertIcon,
  filter: FilterIcon,
  folder: FolderOpenIcon,
  inbox: InboxIcon,
  offline: WifiOffIcon,
  search: SearchIcon,
  sparkles: SparklesIcon,
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
  details?: EmptyStateDetails;
  testId?: string;
}

/** Quiet lines under the body. */
export interface EmptyStateDetails {
  /** What is narrowing the view ("Host demo.example", "Has errors"), listed under an accessible name. */
  chips?: { label: string; items: readonly string[] };
  /** A status line, e.g. an automatic retry countdown. */
  status?: string;
}

const DEFAULT_ICON: Record<EmptyStateTone, EmptyStateIcon> = { empty: 'inbox', error: 'alert', offline: 'offline' };
// why: an error replaces what the person asked for, so it is announced; an offline banner or an empty list is not urgent.
const ROLE: Partial<Record<EmptyStateTone, 'alert' | 'status'>> = { error: 'alert', offline: 'status' };
const NO_ACTIONS: readonly EmptyStateAction[] = [];

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
  actions = NO_ACTIONS,
  details,
  testId,
}: EmptyStateProps) {
  const name = icon === undefined ? DEFAULT_ICON[tone] : icon;
  const Icon = name ? ICONS[name] : undefined;
  return (
    <div className="empty-state" data-tone={tone} data-variant={variant} role={ROLE[tone]} data-testid={testId}>
      {Icon ? (
        <span className="empty-state-icon" aria-hidden="true">
          <Icon />
        </span>
      ) : null}
      <div className="empty-state-text">
        <p className="empty-state-title">{title}</p>
        {body ? <p className="empty-state-body">{body}</p> : null}
        {details?.chips?.items.length ? (
          <ul className="empty-state-chips" aria-label={details.chips.label}>
            {details.chips.items.map((chip) => (
              <li key={chip}>{chip}</li>
            ))}
          </ul>
        ) : null}
        {details?.status ? <p className="empty-state-status">{details.status}</p> : null}
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
    'data-primary': action.primary ? '' : undefined,
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
