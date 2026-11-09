// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { failureActions, failureCopy, TRY_AGAIN } from '../src/client/routing/states.tsx';
import { SignInError } from '../src/client/sign-in.tsx';

afterEach(() => vi.unstubAllGlobals());

describe('failureCopy', () => {
  it('asks a signed-out person to sign in, with no details to open', () => {
    expect(failureCopy('replay', new SignInError(), 'edit')).toEqual({
      failure: 'sign-in',
      kind: 'sign-in',
      title: 'Sign in to edit this replay',
      cause: 'Use your @toggl.com Google account.',
      details: undefined,
    });
    expect(failureCopy('replay', new SignInError()).title).toBe('Sign in to view this replay');
  });

  it('says a missing page is missing, and an expired one expired', () => {
    expect(failureCopy('replay', 'Replay not found')).toMatchObject({
      failure: 'not-found',
      title: 'This replay isn’t here',
    });
    expect(failureCopy('replay', 'This replay has expired')).toMatchObject({
      failure: 'expired',
      kind: 'not-found',
      title: 'This replay has expired',
    });
  });

  it('says a refused page is an access problem', () => {
    expect(failureCopy('review suite', 'Forbidden (403)')).toMatchObject({
      failure: 'no-access',
      title: 'You don’t have access to this review suite',
    });
  });

  it('reads anything else as a retryable error, keeping the message for the details', () => {
    expect(failureCopy('replay', new Error('Replay failed to load (500)'))).toMatchObject({
      failure: 'error',
      kind: 'error',
      title: 'This replay couldn’t open',
      details: 'Replay failed to load (500)',
    });
  });

  it('reports being offline before anything else but sign-in', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(failureCopy('replay', 'Replay not found')).toMatchObject({
      failure: 'offline',
      kind: 'offline',
      title: 'You’re offline',
    });
    expect(failureCopy('replay', new SignInError()).failure).toBe('sign-in');
  });
});

describe('failureActions', () => {
  const back = { label: 'Back to the replay', href: '/r/x' };

  it('offers only Sign in to a signed-out person', () => {
    expect(failureActions('sign-in', '/sign-in', back)).toEqual({
      primary: { label: 'Sign in', href: '/sign-in', testId: 'sign-in' },
    });
  });

  it('leads with the way back when retrying would not help', () => {
    for (const kind of ['not-found', 'expired', 'no-access'] as const)
      expect(failureActions(kind, undefined, back)).toEqual({ primary: back });
  });

  it('leads with Try again and keeps the way back as the secondary when a retry could work', () => {
    for (const kind of ['error', 'offline'] as const)
      expect(failureActions(kind, undefined, back)).toEqual({
        primary: TRY_AGAIN,
        secondary: back,
      });
  });

  it('falls back to all replays when no way back is given', () => {
    expect(failureActions('not-found', undefined).primary).toMatchObject({
      label: 'Back to all replays',
    });
  });
});
