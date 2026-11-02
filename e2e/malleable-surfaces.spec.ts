import { expect, test } from '@playwright/test';
import { openReplay, openWorkshop, closeWorkshop, importPlugin, manifestOf, seedFailingReplay } from './malleable-support.ts';
import { serveApp } from './support.ts';

const app = serveApp({ REPLAYS_BETA_MALLEABLE: 'true' });

test('a user plugin draws sandboxed context and track surfaces and cannot seek without permission', async ({ page, request }) => {
  const base = app().origin;
  const id = await seedFailingReplay(request, base);
  await openReplay(page, `${base}/r/${id}`);
  await openWorkshop(page);
  await importPlugin(page, {
    manifest: manifestOf('surface-test', 'Surface test', ['replay:read'], {
      contextSections: [{ id: 'summary', label: 'Sandbox summary' }],
      tracks: [{ id: 'events', label: 'Sandbox events' }],
    }),
    source:
      "replays.section('summary', (el, ctx) => { el.textContent = 'Sandbox title: ' + ctx.replay.meta.title; }); replays.track('events', () => [{ atMs: 5000, label: 'A sandbox marker', tone: 'warn' }]);",
  });
  await closeWorkshop(page);
  const marker = page.getByRole('button', { name: /Sandbox events: A sandbox marker/ });
  await expect(marker).toBeVisible();
  await marker.click();
  await expect(page.getByText('The marker could not be opened')).toBeVisible();
  await page.getByTestId('context-tab').click();
  const section = page.getByTestId('plugin:user:surface-test:summary-section');
  await expect(section.frameLocator('iframe').getByText('Sandbox title: Checkout with failures')).toBeVisible();
  await expect(section.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
});
