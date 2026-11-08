// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Account, meQuery, queryClient } from '../src/client/queries.ts';
import { IndexPhoneMenu, phoneMenuItems } from '../src/client/index/IndexPhoneMenu.tsx';
import { Topbar } from '../src/client/Topbar.tsx';

let root: Root;
let host: HTMLDivElement;

function setUp() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
}

function tearDown() {
  act(() => {
    root.unmount();
  });
  host.remove();
  queryClient.removeQueries({ queryKey: meQuery.queryKey });
  vi.unstubAllGlobals();
}

function renderBar(me: Account | null, compact = false) {
  queryClient.setQueryData(meQuery.queryKey, me);
  act(() => {
    root.render(createElement(Topbar, { title: 'Checkout', compact }));
  });
}

const OIDC: Account = { id: 'ada@example.com', name: 'Ada Example', session: { signedIn: true, signOutUrl: '/auth/logout' } };

function openMore() {
  const more = host.querySelector<HTMLButtonElement>('[aria-label="More actions"]');
  if (!more) throw new Error('the More menu is not rendered');
  act(() => {
    more.click();
  });
}

describe('the account menu', () => {
  beforeEach(setUp);
  afterEach(tearDown);

  it('names the signed-in person on desktop', () => {
    renderBar(OIDC);
    expect(host.querySelector('[data-testid="account-menu"]')?.getAttribute('aria-label')).toBe('Account: Ada Example');
  });

  it('shows nothing when nobody is signed in (AUTH_MODE=none)', () => {
    renderBar({ id: 'anonymous', session: { signedIn: false } });
    expect(host.querySelector('[data-testid="account-menu"]')).toBeNull();
  });

  it('offers Sign out in More on phones, linking to the server’s sign-out URL', () => {
    renderBar(OIDC, true);
    expect(host.querySelector('[data-testid="account-menu"]')).toBeNull();
    openMore();
    expect(document.querySelector('[data-testid="sign-out"]')?.getAttribute('href')).toBe('/auth/logout');
  });

  it('offers Sign out in the index’s phone sheet, which stands in for More there', () => {
    act(() => {
      root.render(createElement(IndexPhoneMenu, { items: phoneMenuItems({ account: OIDC }) }));
    });
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Menu"]');
    if (!trigger) throw new Error('the phone sheet trigger is not rendered');
    act(() => {
      trigger.click();
    });
    expect(document.querySelector('[data-testid="sign-out"]')?.getAttribute('href')).toBe('/auth/logout');
  });

  it('has no Sign out on phones when the auth mode has no way to sign out', () => {
    renderBar({ id: 'ada@example.com', session: { signedIn: true } }, true);
    openMore();
    expect(document.querySelector('[data-testid="sign-out"]')).toBeNull();
  });

  it('shows nothing on desktop when the auth mode has no way to sign out', () => {
    renderBar({ id: 'ada@example.com', name: 'Ada Example', session: { signedIn: true } });
    expect(host.querySelector('[data-testid="account-menu"]')).toBeNull();
  });
});
