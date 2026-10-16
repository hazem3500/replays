#!/usr/bin/env node
// Regenerates the comment screenshots in docs/screenshots/ (comments-seekbar.png, comments-panel.png,
// comments-mobile.png) from a real server with a seeded copy of the demo recording. Needs `pnpm build` first and Chrome
// (CHROME_PATH, else Playwright's own browser).
//   pnpm build && node --experimental-strip-types --no-warnings scripts/shots-comments.mjs
import { join, resolve } from 'node:path';

import { chromium } from 'playwright-core';

import { startServer } from './test-server.mjs';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'docs/screenshots');
const executablePath = process.env.CHROME_PATH || undefined;

const people = {
  ada: { 'x-e2e-user': 'ada@example.com', 'x-e2e-name': 'Ada Lovelace' },
  bob: { 'x-e2e-user': 'bob@example.com', 'x-e2e-name': 'Bob Stone' },
  grace: { 'x-e2e-user': 'grace@example.com', 'x-e2e-name': 'Grace Hopper' },
};

const server = await startServer({
  env: {
    POSTERS_DISABLED: '1',
    RENDER_DISABLED: '1',
    AUTH_MODE: 'plugin',
    AUTH_PLUGIN: join(root, 'e2e/comments-auth.mjs'),
  },
});
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
try {
  const api = (path, who, init = {}) =>
    fetch(`${server.origin}/api/${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...people[who] },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
  const bundle = await (await api('replays/demo-shop', 'ada')).json();
  const id = 'checkout-review';
  bundle.meta.id = id;
  bundle.meta.title = 'Checkout review';
  await api('replays', 'ada', { method: 'POST', body: bundle });
  const add = async (who, body, extra = {}) =>
    await (await api(`replays/${id}/comments`, who, { method: 'POST', body: { body, ...extra } })).json();
  await add('ada', 'Overall the flow is smooth. Two things flagged below.');
  await add('ada', 'The grid paints before the product images: a flash of empty cards.', { at: 1200 });
  await add('bob', 'Cart badge updates straight away. Nice.', { at: 3000 });
  const email = await add('grace', 'Email accepts “a@b” without a complaint. Should it?', { at: 5500 });
  await add('ada', 'Good catch. The server validates, the form does not.', { parentId: email.id });
  await add('bob', 'Filed it as a follow-up.', { parentId: email.id });
  const coupon = await add('bob', 'The coupon error doesn’t say what is wrong with the code.', { at: 7100 });
  await api(`replays/${id}/comments/${coupon.id}`, 'ada', { method: 'PATCH', body: { resolved: true } });
  await api(`replays/${id}/comments`, 'grace', { method: 'POST', body: { emoji: '👀', at: 4400 } });

  const shoot = async ({ file, width, height, as = 'ada', url, setup }) => {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, extraHTTPHeaders: people[as] });
    await context.addInitScript(() => {
      localStorage.setItem('replays-theme', 'dark');
      localStorage.setItem('replays-inspector-height', '380');
    });
    const page = await context.newPage();
    await page.goto(`${server.origin}/r/${id}${url}`);
    await page.getByTestId('replay-player').locator('iframe').waitFor();
    await page.waitForTimeout(1500);
    await setup(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(out, file) });
    await context.close();
    console.log(`docs/screenshots/${file}`);
  };

  await shoot({
    file: 'comments-seekbar.png',
    width: 1440,
    height: 900,
    url: '?t=5.5',
    setup: async (page) => {
      await page.locator('[data-testid="comment-marker"][data-comment-id]').nth(3).hover();
      await page.getByTestId('comment-card').filter({ visible: true }).waitFor();
    },
  });
  await shoot({
    file: 'comments-panel.png',
    width: 1440,
    height: 900,
    url: '?t=5.5',
    setup: async (page) => {
      await page.getByTestId('comments-tab').click();
      await page.locator('[data-testid="comment-thread"][data-active]').scrollIntoViewIfNeeded();
      await page.mouse.move(700, 300);
    },
  });
  await shoot({
    file: 'comments-mobile.png',
    width: 390,
    height: 844,
    url: '?t=5.5',
    setup: async (page) => {
      await page.getByTestId('comments-tab').click();
      await page.locator('[data-testid="comment-thread"][data-active]').scrollIntoViewIfNeeded();
    },
  });
} finally {
  await browser.close();
  await server.stop();
}
