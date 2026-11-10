// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClientConfig } from '../src/client/config.ts';
import { type Account, configQuery, githubLinkQuery, type GithubLinkState, meQuery, queryClient } from '../src/client/queries.ts';
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
  queryClient.removeQueries({ queryKey: configQuery.queryKey });
  queryClient.removeQueries({ queryKey: githubLinkQuery.queryKey });
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

const listed = (plugins: string[]): ClientConfig => ({ name: 'replays', sourceProviders: [], auth: 'plugin', plugins, editing: { enabled: false } });
const offer = (link: GithubLinkState, plugins = ['github-connect']) => {
  queryClient.setQueryData(configQuery.queryKey, listed(plugins));
  queryClient.setQueryData(githubLinkQuery.queryKey, link);
};
const openAccount = () => {
  const trigger = host.querySelector<HTMLButtonElement>('[data-testid="account-menu"]');
  if (!trigger) throw new Error('the account menu is not rendered');
  act(() => {
    trigger.click();
  });
};

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
      root.render(createElement(IndexPhoneMenu, { account: OIDC, items: phoneMenuItems({ account: OIDC }) }));
    });
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Menu"]');
    if (!trigger) throw new Error('the phone sheet trigger is not rendered');
    expect(trigger.querySelector('svg.lucide-user-round')).not.toBeNull();
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

  it('keeps the index phone trigger as More when the auth mode has no way to sign out', () => {
    const iap: Account = { id: 'ada@example.com', name: 'Ada Example', session: { signedIn: true } };
    act(() => {
      root.render(createElement(IndexPhoneMenu, { account: iap, items: phoneMenuItems({ account: iap }) }));
    });
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Menu"]');
    expect(trigger?.querySelector('svg.lucide-user-round')).toBeNull();
    expect(trigger?.querySelector('[data-icon="ellipsis"]')).not.toBeNull();
  });

  describe('Connect GitHub', () => {
    const IAP: Account = { id: 'ada@example.com', name: 'Ada Example', session: { signedIn: true } };

    it('gives an account without a sign-out URL a menu with Connect GitHub, which starts the server flow from this page', () => {
      offer({ available: true, linked: null });
      renderBar(IAP);
      openAccount();
      const connect = document.querySelector('[data-testid="github-connect"]');
      expect(connect?.getAttribute('href')).toBe(`/auth/github/start?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      expect(document.querySelector('[data-testid="github-disconnect"]')).toBeNull();
    });

    it('shows the linked account with its avatar and Disconnect instead', () => {
      offer({ available: true, linked: { login: 'octocat', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4' } });
      renderBar(IAP);
      openAccount();
      expect(document.querySelector('[data-testid="github-linked"]')?.textContent).toBe('GitHub: octocat');
      expect(document.querySelector('[data-testid="github-linked"] img')?.getAttribute('src')).toBe('https://avatars.githubusercontent.com/u/1?v=4');
      expect(document.querySelector('[data-testid="github-disconnect"]')).not.toBeNull();
      expect(document.querySelector('[data-testid="github-connect"]')).toBeNull();
    });

    it('is absent when the host did not list the plugin, whatever was cached', () => {
      offer({ available: true, linked: null }, []);
      renderBar(IAP);
      expect(host.querySelector('[data-testid="account-menu"]')).toBeNull();
    });

    it('is offered on phones in More', () => {
      offer({ available: true, linked: null });
      renderBar(IAP, true);
      openMore();
      expect(document.querySelector('[data-testid="github-connect"]')).not.toBeNull();
    });
  });
});
