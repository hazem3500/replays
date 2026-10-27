// @vitest-environment happy-dom
// @vitest-environment-options {"url": "http://localhost/"}
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { config } from './msw/handlers.ts';
import { setupMockApi } from './msw/server.ts';

const { mock } = setupMockApi(config({ auth: 'oidc' }));

describe('shared request mocking', () => {
  it('serves the shared handlers and per-test overrides ahead of them', async () => {
    expect(await (await fetch('/api/config')).json()).toEqual({ auth: 'oidc' });
    mock(http.get('*/api/config', () => HttpResponse.json({ auth: 'none' })));
    expect(await (await fetch('/api/config')).json()).toEqual({ auth: 'none' });
  });

  it('drops a previous test’s overrides but keeps the shared handlers', async () => {
    expect(await (await fetch('/api/config')).json()).toEqual({ auth: 'oidc' });
  });

  it('fails a request that no handler claims instead of reaching the network', async () => {
    await expect(fetch('/api/replays')).rejects.toThrow(/Cannot bypass a request when using the "error" strategy/);
  });
});
