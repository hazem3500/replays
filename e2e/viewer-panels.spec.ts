import { expect, test } from '@playwright/test';

import { cloneBundle, openReplay, postBundle, uniqueId, serveApp } from './support.ts';

const server = serveApp();

test('performance leads with verdicts, ranks slow moments worst first, and opens with the P key', async ({ page }) => {
  const id = uniqueId('performance');
  const bundle = await cloneBundle(page.request, server().origin, 'demo-shop', id, 'Performance fixture');
  bundle.performance = {
    supported: ['paint', 'longtask', 'event'],
    entries: [
      { at: 500, kind: 'first-contentful-paint', value: 500 },
      { at: 5000, kind: 'long-task', value: 180 },
      { at: 8000, kind: 'slow-interaction', value: 620, eventType: 'pointerdown' },
      { at: 8001, kind: 'slow-interaction', value: 620, eventType: 'click' },
    ],
  };
  await postBundle(page.request, server().origin, bundle);
  await openReplay(page, `${server().origin}/r/${id}`);
  await page.getByTestId('performance-tab').click();

  const vitals = page.getByTestId('performance-vitals');
  await expect(vitals).toContainText('First paint500 msGood');
  await expect(vitals).toContainText('Slowest interaction620 msPoor');
  await expect(vitals).toContainText('Largest paintNot captured');
  const events = page.getByTestId('performance-events');
  const rows = events.locator('[data-performance-id]');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Click');
  await expect(rows.nth(1)).toContainText('Long task');
  await expect(rows.first()).toHaveAttribute('data-future');

  await rows
    .first()
    .getByRole('button', { name: /^Click/ })
    .click();
  const evidence = page.getByRole('region', { name: 'Selected performance evidence' });
  await expect(evidence).toContainText('620 ms');
  await expect(evidence).toContainText('Poor');
  await evidence.getByRole('button', { name: 'Watch from 0:08.0' }).click();
  await expect(page.getByTestId('playhead')).toHaveText('0:08.0');
  await rows
    .first()
    .getByRole('button', { name: /^Click/ })
    .press('ArrowDown');
  await expect(rows.nth(1).getByRole('button', { name: /^Long task/ })).toBeFocused();
  await expect(evidence).toContainText('180 ms');
  await page.keyboard.press('Escape');
  await expect(evidence).toBeHidden();

  await page.getByRole('button', { name: 'In order', exact: true }).click();
  await expect(rows.first()).toContainText('Long task');

  await page.getByTestId('console-tab').click();
  await page.keyboard.press('p');
  await expect(page.getByTestId('performance-tab')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('slider', { name: 'Seek' }).press('End');
  await expect(events.locator('[data-future]')).toHaveCount(0);
});

test('a slow interaction says what it waited on, and a request around it opens in Network', async ({ page }) => {
  const id = uniqueId('performance-cause');
  const bundle = await cloneBundle(page.request, server().origin, 'demo-shop', id, 'Performance cause fixture');
  bundle.steps = [{ at: 1500, kind: 'click', label: 'Place the order' }];
  bundle.network = [
    {
      id: 'order',
      at: 1520,
      duration: 300,
      method: 'POST',
      url: 'https://shop.test/api/orders',
      status: 500,
      statusText: 'Server Error',
      requestHeaders: [],
      responseHeaders: [],
    },
  ];
  bundle.performance = {
    supported: ['longtask', 'event'],
    entries: [
      { at: 1510, kind: 'slow-interaction', value: 240, eventType: 'click' },
      { at: 1515, kind: 'long-task', value: 200 },
    ],
  };
  await postBundle(page.request, server().origin, bundle);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, `${server().origin}/r/${id}`);
  await page.getByTestId('performance-tab').click();
  const click = page.locator('[data-performance-id]').filter({ hasText: 'Click' });
  await expect(click).toContainText('Place the order · a 200 ms long task blocked the page');
  await click.getByRole('button', { name: /^Click/ }).click();
  const evidence = page.getByRole('region', { name: 'Selected performance evidence' });
  await evidence.getByRole('button', { name: /POST \/api\/orders/ }).click();
  await expect(page.getByTestId('network-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('request-detail')).toContainText('/api/orders');
});

test('a long list of moments stays windowed and keeps its selection across a resize', async ({ page }) => {
  const id = uniqueId('performance-windowed');
  const bundle = await cloneBundle(page.request, server().origin, 'demo-shop', id);
  bundle.performance = {
    supported: ['longtask'],
    entries: Array.from({ length: 200 }, (_, index) => ({ at: 10 + index * 40, kind: 'long-task', value: 60 + (index % 7) * 30 })),
  };
  await postBundle(page.request, server().origin, bundle);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, `${server().origin}/r/${id}`);
  await page.getByTestId('performance-tab').click();
  const rows = page.getByTestId('performance-events').locator('[data-performance-id]');
  expect(await rows.count()).toBeLessThan(200);
  const first = rows.first().locator('button[aria-expanded]');
  await first.press('End');
  const evidence = page.getByRole('region', { name: 'Selected performance evidence' });
  await expect(evidence).toBeVisible();
  const selected = page.getByTestId('performance-events').locator('[data-selected]');
  await expect(selected).toBeInViewport();
  const label = await evidence.locator('.np-detail-status').textContent();
  await page.setViewportSize({ width: 1024, height: 700 });
  await expect(evidence.locator('.np-detail-status')).toHaveText(label!);
  await expect(selected).toBeAttached();
});

test.describe('Performance on a phone', () => {
  test.use({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });

  test('rows fit at 390 px as one 44 px target, and the detail takes the list’s place', async ({ page }) => {
    const id = uniqueId('performance-phone');
    const bundle = await cloneBundle(page.request, server().origin, 'demo-shop', id);
    bundle.steps = [{ at: 1800, kind: 'click', label: 'Open project with a long captured action label' }];
    bundle.performance = {
      supported: ['paint', 'longtask', 'event'],
      entries: [
        { at: 1700, kind: 'slow-interaction', value: 420, eventType: 'pointerdown' },
        { at: 1900, kind: 'long-task', value: 182 },
        { at: 2400, kind: 'first-contentful-paint', value: 196 },
      ],
    };
    await postBundle(page.request, server().origin, bundle);
    await openReplay(page, `${server().origin}/r/${id}`);
    await page.getByTestId('performance-tab').tap();
    const panel = page.getByTestId('performance-diagnostics');
    const events = page.getByTestId('performance-events');
    const buttons = events.locator('[data-performance-id] button[aria-expanded]');
    await expect(buttons).toHaveCount(2);
    const geometry = await panel.evaluate((element) => ({
      overflow: [element, ...element.querySelectorAll<HTMLElement>('.pp-scroll')].some((node) => node.scrollWidth > node.clientWidth + 1),
      targets: [...element.querySelectorAll<HTMLElement>('[data-performance-id] button[aria-expanded]')].map(
        (button) => button.getBoundingClientRect().height,
      ),
    }));
    expect(geometry.overflow).toBe(false);
    expect(geometry.targets.every((height) => height >= 44)).toBe(true);
    await buttons.first().tap();
    const evidence = page.getByRole('region', { name: 'Selected performance evidence' });
    await expect(evidence).toBeVisible();
    await expect(events).toBeHidden();
    await evidence.getByRole('button', { name: 'Back to the list' }).tap();
    await expect(events).toBeVisible();
  });
});

test('an imported recording has an empty Context tab', async ({ page }) => {
  await openReplay(page, `${server().origin}/r/human-demo`);
  await expect(page.getByTestId('console-tab')).toBeVisible();
  await page.getByTestId('context-tab').click();
  await expect(page.getByTestId('context-empty')).toBeVisible();
});

test('context fields render without a schema: humanized keys, Yes/No, chips, nested lists, text URLs', async ({ page }) => {
  const id = uniqueId('fields');
  const bundle = await cloneBundle(page.request, server().origin, 'demo-shop', id, 'Context fields fixture');
  bundle.context = {
    version: 1,
    capturedAt: '2026-10-10T12:00:00.000Z',
    fields: {
      release_channel: 'beta',
      isInternal: true,
      labels: ['alpha', 'beta'],
      owner: { team_name: 'Core', on_call: false },
      ticket_url: 'https://example.com/tickets/7',
    },
  };
  await postBundle(page.request, server().origin, bundle);

  await openReplay(page, `${server().origin}/r/${id}`);
  await page.getByTestId('context-tab').click();
  const fields = page.getByTestId('context-fields');
  const row = (label: string) => fields.locator('.ctx-row', { has: page.locator('.ctx-label', { hasText: new RegExp(`^${label}$`) }) });
  await expect(row('Release channel')).toContainText('beta');
  await expect(row('Is internal')).toContainText('Yes');
  await expect(row('Labels').locator('.ctx-chip')).toHaveText(['alpha', 'beta']);
  const owner = row('Owner');
  await expect(owner.locator('.ctx-rows[data-nested]')).toBeVisible();
  await expect(owner).toContainText('Team');
  await expect(owner).toContainText('Core');
  await expect(owner.locator('.ctx-row', { hasText: 'On call' })).toContainText('No');
  // Without a schema nothing says the string is a link, so it stays text.
  await expect(row('Ticket url')).toContainText('https://example.com/tickets/7');
  await expect(fields.getByRole('link')).toHaveCount(0);
});

test('context sources, build and test details are listed, and only https URLs are links', async ({ page }) => {
  await openReplay(page, `${server().origin}/r/demo-shop`);
  await page.getByTestId('context-tab').click();
  const panel = page.getByTestId('context-panel');
  const sources = panel.getByRole('region', { name: 'Sources' });
  await expect(sources.getByRole('link')).toHaveCount(2);
  await expect(sources.getByRole('link', { name: /^Example ticket/ })).toHaveAttribute('href', 'https://example.com/tickets/DEMO-1');
  await expect(sources.getByRole('link', { name: /^Example ticket/ })).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(sources).toContainText('github');
  await expect(panel.getByRole('region', { name: 'Build' })).toContainText('0.1.0');
  await expect(panel.getByRole('region', { name: 'Test' })).toContainText('rejects an unknown coupon');
});
