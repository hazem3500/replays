import { expect, test } from '@playwright/test';

import { cloneBundle, openReplay, postBundle, uniqueId, serveApp } from './support.ts';

const server = serveApp();

test('performance signals follow the playhead and open with the P key', async ({ page }) => {
  const id = uniqueId('performance');
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

  await openReplay(page, `${server().origin}/r/${id}`);
  await page.getByTestId('step-timeline').locator('[data-step-index="1"]').click();
  await page.getByTestId('performance-tab').click();
  // Every entry is listed; the ones after the playhead are faded and the count reads reached / total.
  await expect(page.getByTestId('performance-tab')).toHaveAccessibleName('Performance, 1 of 3 signals reached');
  await expect(page.locator('.performance-row')).toHaveCount(3);
  await expect(page.locator('.performance-row[data-future]')).toHaveCount(2);
  await expect(page.locator('.performance-row').first()).toContainText(/contentful paint/i);

  await page.getByTestId('console-tab').click();
  await page.keyboard.press('p');
  await expect(page.getByTestId('performance-tab')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('slider', { name: 'Seek' }).press('End');
  await expect(page.locator('.performance-row[data-future]')).toHaveCount(0);
  await expect(page.locator('.performance-row').nth(2)).toContainText('click');
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
