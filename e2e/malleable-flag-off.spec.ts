import { expect, test } from '@playwright/test';

import { origin } from './support.ts';

// beta.malleable is OFF by default (REPLAYS_BETA_MALLEABLE unset on the shared e2e server): no UI, no routes, no bridge, and
// none of its code is requested. e2e/malleable.spec.ts covers the same app with the flag on.

test('the viewer has no workshop, registers no tools and never loads the plugin code', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.goto(`${origin()}/r/demo-shop`);
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByTestId('malleable-open')).toHaveCount(0);
  await expect(page.getByRole('menu')).not.toContainText(/workshop/i);
  await expect(page.locator('meta[name="app-beta"]')).toHaveAttribute('content', '');
  expect(await page.evaluate(() => 'modelContext' in document || 'modelContext' in navigator)).toBe(false);
  await page.waitForTimeout(300);
  expect(requests.filter((path) => /malleable|\/Workshop|MalleableHost|boot-/i.test(path))).toEqual([]);
  // The viewer page carries no extra CSP when the flag is off.
  const response = await page.request.get(`${origin()}/r/demo-shop`, { headers: { accept: 'text/html' } });
  expect(response.headers()['content-security-policy']).toBeUndefined();
});

test('the routes, the sandbox page and the bridge do not exist', async ({ request }) => {
  for (const path of [
    '/api/malleable/plugins',
    '/api/malleable/plugins/user/x',
    '/_malleable/sandbox.html',
    '/api/malleable/bridge/tools',
  ]) {
    const response = await request.get(`${origin()}${path}`);
    expect(response.status(), path).toBe(404);
  }
  for (const path of ['/api/malleable/approvals', '/api/malleable/bridge/pair', '/api/malleable/bridge/call']) {
    expect((await request.post(`${origin()}${path}`, { data: {} })).status(), path).toBe(404);
  }
  const config = await (await request.get(`${origin()}/api/config`)).json();
  expect(config.beta.malleable).toBe(false);
  expect(config.plugins).not.toContain('malleable');
});
