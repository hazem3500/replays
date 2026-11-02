import { CircleDashedIcon, FileQuestionIcon, InboxIcon, type LucideIcon, TriangleAlertIcon, WifiOffIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button, buttonVariants } from '@/components/ui/button.tsx';
import { cn } from '@/lib/utils.ts';

// oxlint-disable-next-line import/no-unassigned-import -- why: the state views' styles ship with the primitive.
import './state-view.css';

export type StateKind = 'empty' | 'error' | 'not-found' | 'offline' | 'not-captured';

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
};

const STRINGS = { details: 'Details' };

/** The kind's small illustration: its glyph (or `glyph`) on a plate over a tilted, dashed second card. */
export function StateArt({ kind, glyph }: { kind: StateKind; glyph?: LucideIcon | undefined }) {
  const Glyph = glyph ?? GLYPHS[kind];
  return (
    <span className="state-art" data-kind={kind} aria-hidden="true">
      <span className="state-art-back" />
      <span className="state-art-plate">
        <Glyph />
      </span>
    </span>
  );
}

function ActionButton({ action, primary }: { action: StateAction; primary: boolean }) {
  const look = { variant: primary ? 'default' : 'ghost', size: 'lg' } as const;
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

/**
 * One look for every empty, error, not-found, offline and not-captured state: the kind's illustration, a plain
 * headline, the cause, one primary action (and at most one quiet secondary), collapsible details for the raw error,
 * and `children` for anything the state needs to teach. `page` sits in the upper third of a page; `panel` is the
 * compact form at the top of a panel.
 */
export function StateView({
  kind,
  title,
  cause,
  actions,
  details,
  layout = 'page',
  testId,
  children,
}: {
  kind: StateKind;
  title: string;
  cause?: ReactNode;
  /** One primary action, and at most one quiet secondary. */
  actions?: { primary?: StateAction | undefined; secondary?: StateAction | undefined } | undefined;
  /** The raw error or identifier, folded away under "Details". */
  details?: string | undefined;
  layout?: 'page' | 'panel';
  testId?: string | undefined;
  children?: ReactNode;
}) {
  // why: a page that failed replaces what was asked for, so it is announced; empty and not-captured notes are not.
  const alert = layout === 'page' && (kind === 'error' || kind === 'not-found' || kind === 'offline');
  const { primary: action, secondary } = actions ?? {};
  return (
    <section className="state-view" data-kind={kind} data-layout={layout} role={alert ? 'alert' : undefined} data-testid={testId}>
      <StateArt kind={kind} />
      <div className="state-view-text">
        {layout === 'page' ? <h1 className="state-view-title">{title}</h1> : <h2 className="state-view-title">{title}</h2>}
        {cause ? <p className="state-view-cause">{cause}</p> : null}
      </div>
      {children}
      {action || secondary ? (
        <div className="state-view-actions">
          {action ? <ActionButton action={action} primary /> : null}
          {secondary ? <ActionButton action={secondary} primary={false} /> : null}
        </div>
      ) : null}
      {details ? (
        <details className="state-view-details">
          <summary>{STRINGS.details}</summary>
          <pre>{details}</pre>
        </details>
      ) : null}
    </section>
  );
}
