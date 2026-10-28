// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentCredentials } from '../src/client/settings/AgentCredentials.tsx';

let host: HTMLDivElement;
let root: Root;
const capabilities = {
  credentials: {
    enabled: true,
    scopes: ['replays:read', 'conversations:read', 'conversations:write'],
    maxExpirySeconds: 3600,
    requiresHostAuthentication: true,
  },
};
const credential = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Development agent',
  scopes: ['replays:read'],
  expiresAt: Date.now() + 3600000,
  revokedAt: null,
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}
function button(text: string) {
  const result = [...host.querySelectorAll('button')].find((element) => element.textContent?.includes(text));
  expect(result).toBeDefined();
  return result!;
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
async function render() {
  await act(async () => root.render(createElement(AgentCredentials)));
}

describe('agent credentials settings', () => {
  it.each([404, 401, 403])('handles capability status %s without exposing credential creation', async (status) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({}, status));
    vi.stubGlobal('fetch', request);
    await render();
    await vi.waitFor(() =>
      expect(host.textContent).toContain(
        status === 404
          ? 'Credential creation isn’t enabled for this deployment.'
          : 'Sign in through this deployment’s authentication provider',
      ),
    );
    expect(host.textContent).not.toContain('New credential');
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[1]?.method).not.toBe('POST');
  });

  it('does not fetch credentials when the host disables issuance', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ credentials: { enabled: false } }));
    vi.stubGlobal('fetch', request);
    await render();
    await vi.waitFor(() => expect(host.textContent).toContain('Credential creation isn’t enabled for this deployment.'));
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[1]?.method).not.toBe('POST');
  });

  it('creates only selected scopes with a bounded expiry, shows the secret once, and revokes', async () => {
    const secret = 'rpl_this-is-a-one-time-test-secret';
    const requests: Array<{ path: string; init: RequestInit | undefined }> = [];
    let created = false;
    const request = vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);
      requests.push({ path, init });
      if (path.endsWith('agent-capabilities')) return response(capabilities);
      if (init?.method === 'POST') {
        created = true;
        return response({ credential, secret }, 201);
      }
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return response({ credentials: created ? [credential] : [] });
    });
    vi.stubGlobal('fetch', request);
    const copy = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    await render();
    await vi.waitFor(() => expect(host.textContent).toContain('New credential'));
    expect(host.textContent).toContain('cannot record or upload');
    expect(host.textContent).toContain('Host sign-in is still required.');
    await click(button('New credential'));
    const name = host.querySelector<HTMLInputElement>('input[placeholder="My development agent"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(name, 'Development agent');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(button('Create credential').disabled).toBe(false);
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(requests.some(({ init }) => init?.method === 'POST')).toBe(true);
    await vi.waitFor(() => expect(host.querySelector<HTMLInputElement>('input[aria-label="New credential secret"]')?.value).toBe(secret));
    const creation = requests.find(({ init }) => init?.method === 'POST')!;
    expect(JSON.parse(String(creation.init?.body))).toEqual({
      name: 'Development agent',
      scopes: ['replays:read'],
      expiresInSeconds: 3600,
    });
    expect(requests.every(({ init }) => init?.credentials === 'same-origin' && init.cache === 'no-store')).toBe(true);
    await click(button('Copy credential'));
    expect(copy).toHaveBeenCalledWith(secret);
    await click(button('I’ve saved it'));
    expect(host.querySelector('[aria-label="New credential secret"]')).toBeNull();
    expect(localStorage.getItem('agent-credential')).toBeNull();
    await click(button('Revoke'));
    await vi.waitFor(() => expect(host.textContent).toContain('Revoked'));
    expect(requests.some(({ path, init }) => path.endsWith(credential.id) && init?.method === 'DELETE')).toBe(true);
    await act(async () => root.render(null));
    await render();
    await vi.waitFor(() => expect(host.textContent).toContain('Development agent'));
    expect(host.querySelector('[aria-label="New credential secret"]')).toBeNull();
    expect(requests.filter(({ init }) => init?.method === 'POST')).toHaveLength(1);
  });

  it('offers a retry without disclosing server error bodies', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ secret: 'never-display-this' }, 500))
      .mockResolvedValueOnce(response({ credentials: { enabled: false } }));
    vi.stubGlobal('fetch', request);
    await render();
    await vi.waitFor(() => expect(host.textContent).toContain('could not be loaded'));
    expect(host.textContent).not.toContain('never-display-this');
    await click(button('Retry credential settings'));
    await vi.waitFor(() => expect(host.textContent).toContain('Credential creation isn’t enabled for this deployment.'));
  });
});
