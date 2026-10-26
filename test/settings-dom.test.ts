// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsButton } from '../src/client/settings/Settings.tsx';
import { ThemeContext } from '../src/client/theme.tsx';

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
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  document.querySelector('meta[name="app-base"]')?.remove();
  vi.unstubAllGlobals();
});

async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => (element as HTMLElement).click());
}

async function openSettings(auth = 'oidc') {
  const fetchConfig = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ auth }), { status: 200 }));
  vi.stubGlobal('fetch', fetchConfig);
  const switchTheme = vi.fn<() => void>();
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ThemeContext.Provider, { value: { theme: 'dark', switchTheme } }, createElement(SettingsButton)),
      ),
    ),
  );
  await click(host.querySelector('[aria-label="Settings"]'));
  return { fetchConfig, switchTheme };
}

describe('workspace settings', () => {
  it('opens a labelled settings dialog and applies appearance choices without changing the selected theme', async () => {
    const { fetchConfig, switchTheme } = await openSettings();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Settings');
    expect(fetchConfig).not.toHaveBeenCalled();
    await click(document.querySelector('[aria-pressed="true"]'));
    expect(switchTheme).not.toHaveBeenCalled();
    await click(document.querySelector('[aria-pressed="false"]'));
    expect(switchTheme).toHaveBeenCalledOnce();
    await click(document.querySelector('[data-slot="dialog-close"]'));
    expect(host.querySelector('[aria-label="Settings"]')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows managed credentials truthfully and uses the deployment base for CLI uploads', async () => {
    const base = document.createElement('meta');
    base.name = 'app-base';
    base.content = '/workspace';
    document.head.append(base);
    const { fetchConfig } = await openSettings();
    await click(
      document.querySelector('[role="tab"][data-value="agents"]') ??
        [...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === 'Agent access')!,
    );
    expect(fetchConfig).toHaveBeenCalledWith('/workspace/api/config', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await vi.waitFor(() => expect(document.body.textContent).toContain('Managed authentication'));
    expect(document.body.textContent).toContain('API token creation is not available');
    expect(document.querySelector('code')?.textContent).toContain('/workspace/api/replays');
    expect(document.querySelector('code')?.textContent).toContain('--header-file headers.json');
    expect([...document.querySelectorAll('button')].some((button) => /create.*token/i.test(button.textContent ?? ''))).toBe(false);
  });

  it('does not request credentials for a deployment configured with open access', async () => {
    await openSettings('none');
    await click([...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === 'Agent access')!);
    await vi.waitFor(() => expect(document.body.textContent).toContain('Open access'));
    expect(document.querySelector('code')?.textContent).not.toContain('--header-file');
  });
});
