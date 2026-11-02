import { expect, test, type Page } from '@playwright/test';

import { cloneBundle, openReplay, postBundle, uniqueId, serveApp } from './support.ts';

const server = serveApp();

async function seedPerformance(page: Page, id: string) {
  const bundle = await cloneBundle(page.request, server().origin, 'demo-shop', id, 'Performance fixture');
  bundle.performance = {
    supported: ['paint', 'longtask', 'event'],
    entries: [
      { at: 500, kind: 'first-contentful-paint', value: 500 },
      { at: 5000, kind: 'long-task', value: 72 },
      { at: 8000, kind: 'slow-interaction', value: 96, eventType: 'click' },
    ],
  };
  await postBundle(page.request, server().origin, bundle);
}

const eventRows = (page: Page) => page.getByTestId('performance-events').getByRole('row');

test('performance events sort worst first, follow the playhead and open with the P key', async ({ page }) => {
  const id = uniqueId('performance');
  await seedPerformance(page, id);
  await openReplay(page, `${server().origin}/r/${id}`);
  await page.getByTestId('step-timeline').locator('[data-step-index="1"]').click();
  await page.getByTestId('performance-tab').click();

  const rows = eventRows(page);
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('Long task');
  await expect(page.getByTestId('performance-events').locator('[data-future]')).toHaveCount(2);

  await rows.first().click();
  await expect(page.getByTestId('playhead')).toHaveText('0:05.0');
  const detail = page.getByRole('region', { name: 'Selected performance event' });
  await expect(detail).toContainText('72 ms · Needs work');
  await expect(detail).toContainText('What was happening');
  await rows.first().press('ArrowDown');
  await expect(page.getByTestId('playhead')).toHaveText('0:08.0');
  await expect(rows.nth(1)).toBeFocused();
  await expect(detail).toContainText('Slow interaction · click');
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden();
  await expect(rows.nth(1)).toBeFocused();

  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(rows.first()).toContainText('First contentful paint');

  const longest = page.getByRole('button', { name: /^Longest task/ });
  await longest.click();
  await expect(longest).toHaveAttribute('aria-pressed', 'true');
  await expect(rows).toHaveCount(1);
  await expect(detail).toContainText('Long task');
  await longest.click();
  await expect(rows).toHaveCount(3);

  await page.getByTestId('console-tab').click();
  await page.keyboard.press('p');
  await expect(page.getByTestId('performance-tab')).toHaveAttribute('aria-selected', 'true');
});

test('performance says “not captured” apart from “nothing slow happened”', async ({ page }) => {
  const id = uniqueId('performance-empty');
  const bundle = await cloneBundle(page.request, server().origin, 'demo-shop', id);
  bundle.performance = { supported: [], entries: [] };
  await postBundle(page.request, server().origin, bundle);
  await openReplay(page, `${server().origin}/r/${id}`);
  await page.getByTestId('performance-tab').click();
  await expect(page.getByTestId('perf-unsupported')).toContainText('Not captured by this browser');
});

test.describe('Performance on a phone', () => {
  test.use({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });

  test('keeps rows touch-sized, the detail in place of the table, and nothing wider than the screen', async ({ page }) => {
    const id = uniqueId('performance-phone');
    await seedPerformance(page, id);
    await openReplay(page, `${server().origin}/r/${id}`);
    await page.getByTestId('performance-tab').tap();
    const panel = page.getByTestId('performance-panel');
    const rows = eventRows(page);
    await expect(rows).toHaveCount(3);
    const heights = await rows.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
    expect(heights.every((height) => height >= 44)).toBe(true);
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

    await rows.first().tap();
    const detail = page.getByRole('region', { name: 'Selected performance event' });
    await expect(detail).toBeVisible();
    await expect(page.getByTestId('performance-events')).toBeHidden();
    await page.getByRole('button', { name: 'Close event details' }).tap();
    await expect(detail).toBeHidden();
    await expect(rows.first()).toBeFocused();
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
