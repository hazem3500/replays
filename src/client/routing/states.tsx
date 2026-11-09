import type { ErrorComponentProps } from '@tanstack/react-router';
import { lazy, type ReactNode, Suspense } from 'react';

import { type StateAction, type StateActions, type StateKind, StateView } from '@/components/ui/state-view.tsx';

import { productLogo, productName } from '../config.ts';
import { signInHref, SignInError, useSignInRedirect } from '../sign-in.tsx';
import { indexHref } from './links.ts';

// why: the mark's geometry shares a module with the index's brand animation, which the entry chunk must not carry.
const ProductMark = lazy(async () => ({ default: (await import('@/components/brand-mark.tsx')).ProductMark }));

/** The product's identity, top left, as on the index: its mark and name, linking home. */
function StateBrand() {
  const logo = productLogo();
  return (
    <a className="state-brand" href={indexHref()}>
      {logo ? (
        <img className="product-logo" src={logo} alt="" width={24} height={24} />
      ) : (
        <Suspense fallback={<span className="state-brand-mark" />}>
          <ProductMark size={24} />
        </Suspense>
      )}
      {productName()}
    </a>
  );
}

/**
 * A page that could not be shown: a StateView under the product's mark. `actions` carry at most one primary; without a
 * `primary` the way back to all replays takes that place.
 */
export function StateShell({
  kind,
  title,
  cause,
  details,
  actions,
  children,
}: {
  kind: StateKind;
  title: string;
  cause?: ReactNode;
  details?: string | undefined;
  actions?: StateActions;
  children?: ReactNode;
}) {
  return (
    <main className="state-shell">
      <StateBrand />
      <StateView
        kind={kind}
        title={title}
        cause={cause}
        details={details}
        actions={
          actions?.primary
            ? actions
            : {
                ...actions,
                primary: { label: STRINGS.back, href: indexHref() },
              }
        }
      >
        {children}
      </StateView>
    </main>
  );
}

/** The shell with no state in it: shown while the browser is being sent to sign in. */
export function StateShellPending() {
  return (
    <main className="state-shell" aria-busy="true">
      <StateBrand />
    </main>
  );
}

export const STRINGS = {
  back: 'Back to all replays',
  tryAgain: 'Try again',
  signIn: 'Sign in',
  signInTitle: (verb: string, thing: string) => `Sign in to ${verb} this ${thing}`,
  signInCause: 'Use your @toggl.com Google account.',
  noAccessTitle: (thing: string) => `You don’t have access to this ${thing}`,
  noAccessCause: 'Ask the person who shared it to give you access, or sign in with a different account.',
  notFound: (thing: string) => `This ${thing} isn’t here`,
  notFoundCause: 'The link may be incomplete or mistyped.',
  expired: (thing: string) => `This ${thing} has expired`,
  expiredCause: 'Recordings are removed once their retention window passes. Ask for a new one if you still need it.',
  offline: 'You’re offline',
  offlineCause: (thing: string) => `Reconnect, then try again to open this ${thing}.`,
  failed: (thing: string) => `This ${thing} couldn’t open`,
  failedCause: 'Something went wrong while loading it. Try again in a moment, or open the details below.',
  noPage: 'There’s no page at this address',
  noPageCause: 'Check the link, or go back to all replays.',
};

/** Reloads the page. */
export const TRY_AGAIN: StateAction = {
  label: STRINGS.tryAgain,
  onSelect: () => location.reload(),
  testId: 'try-again',
};

function failureMessage(failure: unknown) {
  if (typeof failure === 'string') return failure;
  return failure instanceof Error ? failure.message : '';
}

export type FailureKind = 'sign-in' | 'no-access' | 'expired' | 'not-found' | 'offline' | 'error';

function failureKind(failure: unknown, message: string): FailureKind {
  if (failure instanceof SignInError) return 'sign-in';
  if (!(globalThis.navigator?.onLine ?? true)) return 'offline';
  if (/forbidden|403|not allowed|no access/i.test(message)) return 'no-access';
  if (/expired/i.test(message)) return 'expired';
  if (/not found|404/i.test(message)) return 'not-found';
  return 'error';
}

/**
 * The plain copy for a page that failed to load `thing` ("replay", "review suite"): sign-in when the person is signed
 * out (it needs them, not a retry, so it has no details), then no access, expired, not found, offline, else an error.
 * `verb` is what the person was doing ("view", "edit"). The raw message goes to the details.
 */
export function failureCopy(thing: string, failure: unknown, verb = 'view') {
  const message = failureMessage(failure);
  const kind = failureKind(failure, message);
  const copy = {
    'sign-in': {
      title: STRINGS.signInTitle(verb, thing),
      cause: STRINGS.signInCause,
    },
    'no-access': {
      title: STRINGS.noAccessTitle(thing),
      cause: STRINGS.noAccessCause,
    },
    expired: { title: STRINGS.expired(thing), cause: STRINGS.expiredCause },
    'not-found': {
      title: STRINGS.notFound(thing),
      cause: STRINGS.notFoundCause,
    },
    offline: { title: STRINGS.offline, cause: STRINGS.offlineCause(thing) },
    error: { title: STRINGS.failed(thing), cause: STRINGS.failedCause },
  }[kind];
  const stateKind: StateKind = kind === 'expired' ? 'not-found' : kind;
  return {
    failure: kind,
    kind: stateKind,
    ...copy,
    details: kind === 'sign-in' ? undefined : message || undefined,
  };
}

/**
 * The actions for a failure: one primary, always. Sign-in leads with "Sign in" (alone: going back would not help);
 * a missing or forbidden page leads with the way back; a transient failure leads with "Try again" and offers the way
 * back as an outline secondary.
 */
export function failureActions(kind: FailureKind, back?: StateAction, signIn?: string): StateActions {
  const home = back ?? { label: STRINGS.back, href: indexHref() };
  if (kind === 'sign-in' && signIn)
    return {
      primary: { label: STRINGS.signIn, href: signIn, testId: 'sign-in' },
    };
  if (kind === 'offline' || kind === 'error') return { primary: TRY_AGAIN, secondary: home };
  return { primary: home };
}

/** A page that failed to load `thing`: the failure's copy and actions, and the browser sent to sign in when that is the cause. */
export function FailureShell({
  thing,
  failure,
  verb,
  back,
  details,
}: {
  thing: string;
  failure: unknown;
  verb?: string;
  back?: StateAction;
  details?: string | undefined;
}) {
  const copy = failureCopy(thing, failure, verb);
  const redirecting = useSignInRedirect(failure);
  if (redirecting) return <StateShellPending />;
  const { failure: kind, details: raw, ...view } = copy;
  return (
    <StateShell
      {...view}
      details={kind === 'sign-in' ? undefined : (details ?? raw)}
      actions={failureActions(kind, back, failure instanceof SignInError ? signInHref() : undefined)}
    />
  );
}

/** An address that is not a page of this app. */
export function NotFoundPage() {
  return <StateShell kind="not-found" title={STRINGS.noPage} cause={STRINGS.noPageCause} />;
}

/** A page whose render failed: what failed, sign-in when that is the cause, and a retry. */
export function RouteErrorPage({ error }: ErrorComponentProps) {
  return <FailureShell thing="page" failure={error} />;
}
