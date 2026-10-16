#!/usr/bin/env node
// Regenerates docs/screenshots/malleable/*: the plugin workshop, an agent-made tab, the permission prompt and the keep dialog on
// desktop and phone, plus a short recording of the agent flow. Drives a real server with REPLAYS_BETA_MALLEABLE=true and a
// scripted agent (e2e/fake-agent.ts) over the real MCP server: no model, no API key. Needs `pnpm build` and Chrome.
//   pnpm build && node --experimental-strip-types --no-warnings scripts/shots-malleable.mjs
import { mkdir, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { chromium } from 'playwright-core';

import { FakeAgent, writeFailedByEndpointPlugin } from '../e2e/fake-agent.ts';
import { startServer } from './test-server.mjs';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'docs/screenshots/malleable');
await mkdir(out, { recursive: true });
const executablePath = process.env.CHROME_PATH || undefined;

const server = await startServer({ env: { POSTERS_DISABLED: '1', RENDER_DISABLED: '1', REPLAYS_BETA_MALLEABLE: 'true' } });
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });

async function seed() {
  const bundle = await (await fetch(`${server.origin}/api/replays/demo-shop`)).json();
  const id = 'checkout-failures';
  bundle.meta.id = id;
  bundle.meta.title = 'Checkout with failures';
  const template = bundle.network[0];
  const failing = [
    ['GET', '/api/coupons/SPRING10', 404, 3200],
    ['GET', '/api/coupons/WELCOME5', 404, 3900],
    ['POST', '/api/orders', 500, 5200],
    ['POST', '/api/orders', 500, 6100],
    ['GET', '/api/users/1042/profile', 403, 6500],
    ['GET', '/api/users/2210/profile', 403, 6900],
  ];
  bundle.network = [
    ...bundle.network.filter((entry) => entry.status < 400),
    ...failing.map(([method, path, status, at], index) => ({
      ...template,
      id: `fail-${index}`,
      method,
      url: `http://127.0.0.1:4173${path}`,
      status,
      statusText: status === 404 ? 'Not Found' : status === 403 ? 'Forbidden' : 'Server Error',
      at,
      duration: 40 + index * 7,
    })),
  ];
  const response = await fetch(`${server.origin}/api/replays`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(bundle),
  });
  if (response.status !== 201) throw new Error(`seed failed: ${response.status}`);
  return id;
}

const autoComment = {
  manifest: {
    format: 'replays-user-plugin/1',
    id: 'auto-comment',
    name: 'Comment every console error',
    description: 'Adds a comment at each console error.',
    permissions: ['replay:read', 'comments:write'],
    contributes: { actions: [{ id: 'run', label: 'Comment every console error' }] },
  },
  source: `replays.action('run', async (ctx) => {
  for (const e of ctx.replay.console.filter((c) => c.level === 'error'))
    await ctx.comments.add({ at: e.at, body: 'Console error: ' + e.message });
});`,
};

async function flow(name, { viewport, mobile, record }) {
  const context = await browser.newContext({
    viewport,
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { deviceScaleFactor: 1 }),
    colorScheme: 'dark',
    ...(record ? { recordVideo: { dir: join(out, '.video'), size: viewport } } : {}),
  });
  const page = await context.newPage();
  const shot = (what) => page.screenshot({ path: join(out, `${what}-${name}.png`) });
  await page.goto(`${server.origin}/r/checkout-failures`);
  await page.getByTestId('replay-player').locator('iframe').waitFor({ state: 'attached' });
  const more = async (item) => {
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByTestId(item).click();
  };
  await more('malleable-open');
  await page.getByTestId('workshop-view-agent').click();
  await page.getByTestId('agent-connect').click();
  await page.locator('[data-testid="bridge-token"]:not([value=""])').waitFor();
  const token = await page.getByTestId('bridge-token').inputValue();
  const agent = new FakeAgent(server.origin, token);
  await agent.initialize();
  try {
    const plugin = writeFailedByEndpointPlugin();
    await agent.call('get_app_state');
    await agent.call('install_plugin_draft', plugin);
    await agent.call('install_plugin_draft', {
      ...autoComment,
      manifest: autoComment.manifest,
    });
    await page.getByTestId('workshop-view-plugins').click();
    await page.getByTestId('plugin-item:failed-by-endpoint').click();
    await page.waitForTimeout(500);
    await shot('editor');
    await page.getByTestId('workshop-close').click();
    await agent.call('open_tab', { tab: 'plugin:user-failed-by-endpoint:main' });
    await page.getByTestId('plugin:user-failed-by-endpoint:main-panel').frameLocator('iframe').getByTestId('summary').waitFor();
    await page.waitForTimeout(400);
    await shot('agent-tab');
    await more('plugin-action:user-auto-comment:run');
    await page.getByTestId('permission-prompt').waitFor();
    await page.waitForTimeout(300);
    await shot('permission-prompt');
    await page.getByTestId('permission-deny').click();
    await agent.call('request_keep', { id: 'failed-by-endpoint' });
    await page.getByTestId('keep-dialog').waitFor();
    await page.waitForTimeout(300);
    await shot('keep-dialog');
    await page.getByTestId('keep-cancel').click();
  } finally {
    agent.stop();
  }
  const video = record ? page.video() : undefined;
  await context.close();
  if (video) {
    await rename(await video.path(), join(out, 'agent-flow.webm'));
    await rm(join(out, '.video'), { recursive: true, force: true });
  }
}

try {
  await seed();
  await flow('desktop', { viewport: { width: 1440, height: 900 }, record: true });
  await flow('mobile', { viewport: { width: 390, height: 844 }, mobile: true });
} finally {
  await browser.close();
  await server.stop();
}
