// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppRouter } from '../src/client/router.tsx';
import { setClientRouter } from '../src/client/routing/client.ts';
import { closeSettings, openSettings, SettingsButton } from '../src/client/settings/Settings.tsx';
import { setBetaAllowedForTests } from '../src/client/settings/labs.ts';
import { settle } from './settle.ts';

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  await settle(() => closeSettings());
  await settle(() => root.unmount());
  client.clear();
  host.remove();
  document.querySelector('meta[name="app-base"]')?.remove();
  setBetaAllowedForTests(undefined);
  localStorage.clear();
  vi.unstubAllGlobals();
});

function present(element: Element | null) {
  if (!(element instanceof HTMLElement)) throw new Error('expected the element to be rendered');
  return element;
}

async function click(element: Element | null) {
  const target = present(element);
  await settle(() => target.click());
}

async function key(element: Element | null, keyName: string) {
  const target = present(element);
  await settle(() => target.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true })));
}

const announced = (text: string) => [...document.querySelectorAll('[role="status"]')].some((element) => element.textContent === text);

function mockConfig(auth = 'oidc', deviceLogin = false) {
  const config = { auth, core: '1.2.3', name: 'replays', ...(deviceLogin ? { cliDeviceAuth: { type: 'oidc-device' } } : {}) };
  const respond = (input: RequestInfo | URL) =>
    String(input).endsWith('/agent-capabilities') ? new Response(null, { status: 404 }) : new Response(JSON.stringify(config));
  const fetchConfig = vi.fn<typeof fetch>().mockImplementation((input) => Promise.resolve(respond(input)));
  vi.stubGlobal('fetch', fetchConfig);
  return fetchConfig;
}

async function render() {
  await settle(() => root.render(createElement(QueryClientProvider, { client }, createElement(SettingsButton))));
}

async function openFromButton(auth = 'oidc', deviceLogin = false) {
  const fetchConfig = mockConfig(auth, deviceLogin);
  await render();
  await click(host.querySelector('[aria-label="Settings"]'));
  return { fetchConfig };
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const tab = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((element) => element.textContent === name) ?? null;
const panel = () => document.querySelector<HTMLElement>('[role="tabpanel"]');

describe('Settings', () => {
  it('opens on a sidebar of sections that the arrow keys, Home and End move through', async () => {
    await openFromButton();
    expect(dialog()?.textContent).toContain('Settings');
    const list = document.querySelector('[role="tablist"]');
    expect(list?.getAttribute('aria-orientation')).toBe('vertical');
    expect(list?.getAttribute('data-slot')).toBe('settings.sections');
    expect([...document.querySelectorAll('[role="tab"]')].map((element) => element.getAttribute('data-slot-item'))).toEqual([
      'core:cli',
      'core:keyboard',
      'core:labs',
      'core:about',
    ]);
    expect(tab('CLI & agents')?.getAttribute('aria-selected')).toBe('true');
    expect([...document.querySelectorAll('[role="tab"]')].filter((element) => element.getAttribute('tabindex') === '0')).toHaveLength(1);
    await key(tab('CLI & agents'), 'ArrowDown');
    expect(tab('Keyboard')?.getAttribute('aria-selected')).toBe('true');
    expect(panel()?.textContent).toContain('Play or pause');
    await key(tab('Keyboard'), 'End');
    expect(tab('About')?.getAttribute('aria-selected')).toBe('true');
    await key(tab('About'), 'Home');
    expect(tab('CLI & agents')?.getAttribute('aria-selected')).toBe('true');
    await key(tab('CLI & agents'), 'ArrowUp');
    expect(tab('About')?.getAttribute('aria-selected')).toBe('true');
    await click(document.querySelector('[aria-label="Close settings"]'));
    expect(host.querySelector('[aria-label="Settings"]')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('leaves the colour theme to the top bar instead of repeating it in any section', async () => {
    await openFromButton();
    for (const section of ['CLI & agents', 'Keyboard', 'Labs', 'About']) {
      await click(tab(section));
      expect(panel()?.querySelector('[role="radiogroup"]')).toBeNull();
      const labels = [...(dialog()?.querySelectorAll('button') ?? [])].map((button) => button.textContent);
      expect(labels).not.toContain('Light');
      expect(labels).not.toContain('Dark');
    }
  });

  it('shows device sign-in and upload-only commands only when the server advertises device login', async () => {
    await openFromButton('oidc', true);
    await click(tab('CLI & agents'));
    await vi.waitFor(() => expect(panel()?.textContent).toContain('Device sign-in'));
    const commands = [...document.querySelectorAll<HTMLInputElement>('.settings-command-text')].map((input) => input.value);
    expect(commands[0]).toBe('git clone https://github.com/hazem3500/replays.git && cd replays && pnpm install --frozen-lockfile');
    expect(commands[1]).toContain('pnpm cli connect');
    expect(commands).toContain('pnpm cli login');
    expect(commands.at(-1)).toBe('pnpm cli upload replay.json');
  });

  it('copies the setup command for the deployment base and announces it', async () => {
    const base = document.createElement('meta');
    base.name = 'app-base';
    base.content = '/workspace';
    document.head.append(base);
    const fetchConfig = mockConfig();
    await render();
    await settle(() => openSettings('cli'));
    expect(fetchConfig).toHaveBeenCalledWith('/workspace/api/config', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await vi.waitFor(() => expect(panel()?.textContent).toContain('Host-managed sign-in'));
    expect(panel()?.textContent).toContain('Credential creation isn’t enabled for this deployment.');
    const setup = document.querySelector<HTMLInputElement>('input[aria-label="Server setup command"]');
    expect(setup?.readOnly).toBe(true);
    expect(setup?.value).toBe("pnpm cli connect 'http://localhost:3000/workspace' && pnpm cli doctor");
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Upload command"]')?.value).toContain('--header-file headers.json');
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await click(document.querySelector('[aria-label="Copy server setup command"]'));
    expect(writeText).toHaveBeenCalledWith("pnpm cli connect 'http://localhost:3000/workspace' && pnpm cli doctor");
    await vi.waitFor(() => expect(announced('Copied')).toBe(true));
  });

  it('leaves out the header file for an open-access deployment', async () => {
    mockConfig('none');
    await render();
    await settle(() => openSettings('cli'));
    await vi.waitFor(() => expect(panel()?.textContent).toContain('App sign-in is disabled. Anyone who can reach this app can use it.'));
    expect(panel()?.textContent).toContain('These settings do not describe that proxy.');
    expect(panel()?.textContent).toContain('The CLI is not published to npm yet.');
    expect(panel()?.querySelector('.settings-credentials')?.hasAttribute('open')).toBe(false);
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Upload command"]')?.value).toBe('pnpm cli upload replay.json');
  });

  it('says plainly when the server offers no experiments', async () => {
    mockConfig();
    await render();
    await settle(() => openSettings('labs'));
    expect(tab('Labs')?.getAttribute('aria-selected')).toBe('true');
    const empty = panel()?.querySelector('[data-testid="labs-empty"]');
    expect(empty?.textContent).toContain('No experiments are available');
    expect(empty?.textContent).not.toContain('REPLAYS_BETA');
    expect(empty?.querySelector('a')?.getAttribute('href')).toContain('#beta-features-and-labs');
    expect(panel()?.querySelector('[role="switch"]')).toBeNull();
    expect(panel()?.textContent).not.toContain('Not enabled');
  });

  it('lists only allowed experiments as switches, saves the choice in this browser and asks for a reload when needed', async () => {
    setBetaAllowedForTests({ editor: true, malleable: true });
    mockConfig();
    await render();
    await settle(() => openSettings('labs'));
    const text = panel()?.textContent ?? '';
    expect(text).toContain('Replay editor');
    expect(text).toContain('Plugin workshop');
    expect(text).not.toContain('Grouped');
    expect(text).not.toContain('Reload to apply');
    const switches = [...(panel()?.querySelectorAll<HTMLElement>('[role="switch"]') ?? [])];
    expect(switches.map((element) => element.getAttribute('aria-checked'))).toEqual(['true', 'true']);
    await click(switches[0] ?? null);
    expect(localStorage.getItem('replays-labs-editor')).toBe('off');
    expect(panel()?.textContent).not.toContain('Reload to apply');
    await click(switches[1] ?? null);
    expect(localStorage.getItem('replays-labs-malleable')).toBe('off');
    expect(panel()?.querySelectorAll('[role="switch"][aria-checked="false"]')).toHaveLength(2);
    expect(panel()?.textContent).toContain('Reload to apply');
  });

  it('opens a section from the ?settings= deep link and drops it on close', async () => {
    window.history.replaceState(null, '', '/?settings=about');
    setClientRouter(createAppRouter({ queryClient: client, deployment: { base: '', name: 'replays' } }));
    mockConfig();
    await render();
    expect(tab('About')?.getAttribute('aria-selected')).toBe('true');
    await vi.waitFor(() => expect(panel()?.textContent).toContain('1.2.3'));
    await click(document.querySelector('[aria-label="Close settings"]'));
    expect(window.location.search).toBe('');
  });

  it('gives a deep-linked dialog the focus instead of its selected tab, which would wear the keyboard ring', async () => {
    window.history.replaceState(null, '', '/?settings=labs');
    mockConfig();
    await render();
    expect(tab('Labs')?.getAttribute('aria-selected')).toBe('true');
    await vi.waitFor(() => expect(document.activeElement).toBe(dialog()));
  });

  it('separates alternative keys with "or" but shows a back-and-forward pair side by side', async () => {
    window.history.replaceState(null, '', '/?settings=keyboard');
    mockConfig();
    await render();
    const keys = [...document.querySelectorAll('.settings-keys')].map((element) => element.textContent);
    expect(keys).toContain('SpaceorK');
    expect(keys).toContain('←→');
    expect(keys).not.toContain('←or→');
  });
});
