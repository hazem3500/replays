import {
  CircleDashedIcon,
  FileQuestionIcon,
  InboxIcon,
  LockIcon,
  LogInIcon,
  type LucideIcon,
  TriangleAlertIcon,
  WifiOffIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { Button, buttonVariants } from '@/components/ui/button.tsx';
import { cn } from '@/lib/utils.ts';

// oxlint-disable-next-line import/no-unassigned-import -- why: the state views' styles ship with the primitive.
import './state-view.css';

export type StateKind = 'empty' | 'error' | 'not-found' | 'offline' | 'not-captured' | 'sign-in' | 'no-access';

export type StateAction = { label: string; testId?: string } & (
  | { onSelect: () => void; href?: never }
  | { href: string; onSelect?: never }
);

const GLYPHS: Record<StateKind, LucideIcon> = {
  empty: InboxIcon,
  error: TriangleAlertIcon,
  'not-found': FileQuestionIcon,
  offline: WifiOffIcon,
  'not-captured': CircleDashedIcon,
  'sign-in': LogInIcon,
  'no-access': LockIcon,
};

const STRINGS = { details: 'Details' };

/** The kind's small illustration: its glyph (or `glyph`) on a plate, tinted only for real errors and warnings. */
export function StateArt({ kind, glyph }: { kind: StateKind; glyph?: LucideIcon | undefined }) {
  const Glyph = glyph ?? GLYPHS[kind];
  return (
    <span className="state-art" data-kind={kind} aria-hidden="true">
      <span className="state-art-plate">
        <Glyph />
      </span>
    </span>
  );
}

type ActionRank = 'primary' | 'secondary' | 'tertiary';
const VARIANTS = { primary: 'default', secondary: 'outline', tertiary: 'ghost' } as const;

function ActionButton({ action, rank }: { action: StateAction; rank: ActionRank }) {
  const look = { variant: VARIANTS[rank], size: 'lg' } as const;
  // why: a way back navigates, so it is a real link (Base UI's Button would give the anchor a button role).
  if (action.href !== undefined)
    return (
      <a className={cn(buttonVariants(look), 'state-action')} href={action.href} data-testid={action.testId}>
        {action.label}
      </a>
    );
  return (
    <Button {...look} className="state-action" type="button" onClick={action.onSelect} data-testid={action.testId}>
      {action.label}
    </Button>
  );
}

function presentationOf(presentation: StateKind | { kind: StateKind; illustration: ReactNode }, layout: 'page' | 'panel') {
  const kind = typeof presentation === 'string' ? presentation : presentation.kind;
  const illustration = typeof presentation === 'string' ? undefined : presentation.illustration;
  // why: a page that failed replaces what was asked for, so it is announced; empty and not-captured notes are not.
  const alert = layout === 'page' && (kind === 'error' || kind === 'not-found' || kind === 'offline');
  return { kind, illustration, alert };
}

export interface StateActions {
  primary?: StateAction | undefined;
  secondary?: StateAction | undefined;
  tertiary?: StateAction | undefined;
}

function StateActionRow({ actions }: { actions?: StateActions | undefined }) {
  const ranked = (['primary', 'secondary', 'tertiary'] as const).flatMap((rank) => {
    const action = actions?.[rank];
    return action ? [{ rank, action }] : [];
  });
  if (ranked.length === 0) return null;
  return (
    <div className="state-view-actions">
      {ranked.map(({ rank, action }) => (
        <ActionButton key={rank} action={action} rank={rank} />
      ))}
    </div>
  );
}

/**
 * One look for every empty, error, not-found, offline and not-captured state: the kind's illustration, a plain
 * headline, the cause, one primary action (then an outline secondary and a ghost tertiary at most), collapsible details for the raw error,
 * and `children` for anything the state needs to teach. `page` sits in the upper third of a page; `panel` is the
 * compact form at the top of a panel.
 */
export function StateView({
  kind: presentation,
  title,
  cause,
  actions,
  details,
  layout = 'page',
  testId,
  children,
}: {
  /** A state kind, optionally paired with replacement artwork. */
  kind: StateKind | { kind: StateKind; illustration: ReactNode };
  title: string;
  cause?: ReactNode;
  /** At most one primary (filled), then an outline secondary and a ghost tertiary. */
  actions?: StateActions | undefined;
  /** The raw error or identifier, folded away under "Details". */
  details?: string | undefined;
  layout?: 'page' | 'panel';
  testId?: string | undefined;
  children?: ReactNode;
}) {
  const { kind, illustration, alert } = presentationOf(presentation, layout);
  return (
    <section className="state-view" data-kind={kind} data-layout={layout} role={alert ? 'alert' : undefined} data-testid={testId}>
      {illustration ?? <StateArt kind={kind} />}
      <div className="state-view-text">
        {layout === 'page' ? <h1 className="state-view-title">{title}</h1> : <h2 className="state-view-title">{title}</h2>}
        {cause ? <p className="state-view-cause">{cause}</p> : null}
      </div>
      {children}
      <StateActionRow actions={actions} />
      {details ? (
        <details className="state-view-details">
          <summary>{STRINGS.details}</summary>
          <pre>{details}</pre>
        </details>
      ) : null}
    </section>
  );
}
