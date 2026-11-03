import { expect, test, type Locator } from '@playwright/test';
import type { ReplayBundle } from '@hazem3500/replays/model';

import { composedRecording } from './compose-fixture.ts';

async function load(pane: Locator, bundle: ReplayBundle) {
  await pane.getByLabel('Choose replay JSON').setInputFiles({
    name: `${bundle.meta.id}.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle)),
  });
  await expect(pane.getByRole('heading', { name: bundle.meta.title, exact: true })).toBeVisible();
  await expect(pane.frameLocator('.stage iframe').locator('body')).toContainText(bundle.meta.title);
}

test('custom controls, steps and diagnostics affect only their own replay instance', async ({ page }) => {
  await page.goto('/');
  const a = page.getByRole('region', { name: 'Recording A', exact: true });
  const b = page.getByRole('region', { name: 'Recording B', exact: true });
  await load(a, composedRecording('a', 'First checkout'));
  await load(b, composedRecording('b', 'Second checkout'));

  await a.getByRole('button', { name: '1×', exact: true }).click();
  await expect(a.getByRole('button', { name: '2×', exact: true })).toBeVisible();
  await expect(b.getByRole('button', { name: '1×', exact: true })).toBeVisible();
  await a.getByRole('button', { name: 'First checkout review' }).click();
  await expect(a.getByRole('slider', { name: 'Position' })).toHaveValue('2000');
  await expect(a.getByRole('button', { name: 'First checkout review' })).toHaveAttribute('aria-current', 'step');
  await expect(b.getByRole('slider', { name: 'Position' })).toHaveValue('0');

  await expect(a.getByRole('region', { name: 'Custom diagnostics' })).toContainText('1 console messages, 1 requests');
  await a.getByRole('button', { name: /Console error: First checkout payment failed/ }).click();
  await expect(a.getByRole('slider', { name: 'Position' })).toHaveValue('3500');
  await b.getByRole('button', { name: /POST example\.com\/payment failed/ }).click();
  await expect(b.getByRole('slider', { name: 'Position' })).toHaveValue('4000');
  await expect(a.getByRole('slider', { name: 'Position' })).toHaveValue('3500');

  await a.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => Number(await a.getByRole('slider', { name: 'Position' }).inputValue())).toBeGreaterThan(3500);
  await a.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(b.getByRole('slider', { name: 'Position' })).toHaveValue('4000');
  await expect(page.locator('.app-shell')).toHaveCount(0);
});

test('replacing a playing recording resets its clock without remounting the other pane', async ({ page }) => {
  await page.goto('/');
  const a = page.getByRole('region', { name: 'Recording A', exact: true });
  const b = page.getByRole('region', { name: 'Recording B', exact: true });
  await load(a, composedRecording('old', 'Original checkout'));
  await load(b, composedRecording('retained', 'Retained checkout'));
  await b.getByRole('button', { name: 'Retained checkout review' }).click();
  await b.getByRole('button', { name: '1×', exact: true }).click();
  const retainedFrame = await b.locator('iframe').elementHandle();
  expect(retainedFrame).not.toBeNull();
  await a.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(a.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

  await load(a, composedRecording('replacement', 'Replacement checkout'));
  await expect(a.locator('iframe')).toHaveCount(1);
  await expect(a.getByRole('slider', { name: 'Position' })).toHaveValue('0');
  await expect(a.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(a.getByRole('button', { name: '1×', exact: true })).toBeVisible();
  await expect(b.getByRole('slider', { name: 'Position' })).toHaveValue('2000');
  await expect(b.getByRole('button', { name: '2×', exact: true })).toBeVisible();
  expect(await retainedFrame?.evaluate((frame) => frame.isConnected)).toBe(true);
  await expect(a.getByRole('list', { name: 'Replay steps' })).not.toContainText('Original checkout');
});

test('a rejected local file keeps the loaded recording and the other instance usable', async ({ page }) => {
  await page.goto('/');
  const a = page.getByRole('region', { name: 'Recording A', exact: true });
  const b = page.getByRole('region', { name: 'Recording B', exact: true });
  await load(a, composedRecording('good', 'Valid checkout'));
  await load(b, composedRecording('independent', 'Independent checkout'));
  await a.getByRole('button', { name: 'Valid checkout review' }).click();
  await a.getByLabel('Choose replay JSON').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{') });
  await expect(a.getByRole('alert')).toBeVisible();
  await expect(a.getByRole('slider', { name: 'Position' })).toHaveValue('2000');
  await expect(a.frameLocator('.stage iframe').locator('body')).toContainText('Valid checkout');
  await b.getByRole('button', { name: 'Independent checkout review' }).click();
  await expect(b.getByRole('slider', { name: 'Position' })).toHaveValue('2000');
  await load(a, composedRecording('recovered', 'Recovered checkout'));
  await expect(a.getByRole('alert')).toHaveCount(0);
});
