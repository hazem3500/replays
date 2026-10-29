import type { ErrorComponentProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { productName } from '../config.ts';
import { SignInLink } from '../sign-in.tsx';
import { indexHref } from './links.ts';

/** A page that could not be shown: what happened, the way back to the index, and any page-specific actions. */
export function StateShell({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <main className="state-shell">
      <a className="state-brand" href={indexHref()}>
        {productName()}
      </a>
      <section className="state-content" role="alert">
        <span className="state-kicker">{kicker}</span>
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}

export function TryAgain() {
  return (
    <button type="button" className="button secondary" onClick={() => location.reload()}>
      Try again
    </button>
  );
}

/** An address that is not a page of this app. */
export function NotFoundPage() {
  return (
    <StateShell kicker="Not found" title="There is no page at this address">
      <div className="state-actions">
        <a className="button" href={indexHref()}>
          Back to all replays
        </a>
      </div>
    </StateShell>
  );
}

/** A page whose render failed: what failed, sign-in when that is the cause, and a retry. */
export function RouteErrorPage({ error }: ErrorComponentProps) {
  return (
    <StateShell kicker="Something went wrong" title={error instanceof Error ? error.message : 'This page failed to load'}>
      <SignInLink error={error} />
      <div className="state-actions">
        <a className="button" href={indexHref()}>
          Back to all replays
        </a>
        <TryAgain />
      </div>
    </StateShell>
  );
}
