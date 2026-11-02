import type { ErrorComponentProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { type StateAction, type StateKind, StateView } from '@/components/ui/state-view.tsx';

import { productName } from '../config.ts';
import { SignInLink } from '../sign-in.tsx';
import { indexHref } from './links.ts';

/**
 * A page that could not be shown: a StateView under the product's mark. The way back (to all replays, or `back`) is its
 * one primary action; `secondary` is a quiet second (usually "Try again"), and `children` carry sign-in when that is
 * the cause.
 */
export function StateShell({
  kind,
  title,
  cause,
  details,
  back,
  secondary,
  children,
}: {
  kind: StateKind;
  title: string;
  cause?: ReactNode;
  details?: string | undefined;
  back?: StateAction;
  secondary?: StateAction | undefined;
  children?: ReactNode;
}) {
  return (
    <main className="state-shell">
      <a className="state-brand" href={indexHref()}>
        {productName()}
      </a>
      <StateView
        kind={kind}
        title={title}
        cause={cause}
        details={details}
        actions={{ primary: back ?? { label: STRINGS.back, href: indexHref() }, secondary }}
      >
        {children}
      </StateView>
    </main>
  );
}

const STRINGS = {
  back: 'Back to all replays',
  tryAgain: 'Try again',
  notFound: (thing: string) => `This ${thing} isn’t here`,
  notFoundCause: 'It may have expired, or the link may be incomplete.',
  offline: 'You’re offline',
  offlineCause: (thing: string) => `Reconnect, then try again to open this ${thing}.`,
  failed: (thing: string) => `This ${thing} couldn’t open`,
  failedCause: 'Something went wrong while loading it. Try again, or open the details below.',
};

/** Reloads the page: the quiet second action of a page that failed. */
export const TRY_AGAIN: StateAction = { label: STRINGS.tryAgain, onSelect: () => location.reload(), testId: 'try-again' };

/**
 * The plain copy for a page that failed to load `thing` ("replay", "review suite"): not found when the message says so,
 * offline when the browser is, else an error; the raw message goes to the details.
 */
export function failureCopy(thing: string, message: string) {
  let kind: 'offline' | 'not-found' | 'error' = 'error';
  if (/not found|expired|404/i.test(message)) kind = 'not-found';
  if (!(globalThis.navigator?.onLine ?? true)) kind = 'offline';
  const copy = {
    'not-found': { title: STRINGS.notFound(thing), cause: STRINGS.notFoundCause },
    offline: { title: STRINGS.offline, cause: STRINGS.offlineCause(thing) },
    error: { title: STRINGS.failed(thing), cause: STRINGS.failedCause },
  }[kind];
  return { kind, ...copy, details: message || undefined };
}

/** An address that is not a page of this app. */
export function NotFoundPage() {
  return <StateShell kind="not-found" title="There’s no page at this address" cause="Check the link, or go back to all replays." />;
}

/** A page whose render failed: what failed, sign-in when that is the cause, and a retry. */
export function RouteErrorPage({ error }: ErrorComponentProps) {
  const copy = failureCopy('page', error instanceof Error ? error.message : '');
  return (
    <StateShell {...copy} secondary={TRY_AGAIN}>
      <SignInLink error={error} />
    </StateShell>
  );
}
