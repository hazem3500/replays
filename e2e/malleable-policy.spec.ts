import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import {
  closeWorkshop,
  importPlugin,
  manifestOf,
  openMore,
  openReplay,
  openWorkshop,
  panelFrame,
  seedFailingReplay,
} from './malleable-support.ts';
import { serveApp } from './support.ts';

// A host that narrows user plugins: personal plugins only, no downloads, the Context tab locked, and a named distribution.
const configFile = join(mkdtempSync(join(tmpdir(), 'replays-policy-e2e-')), 'replays.config.json');
writeFileSync(
  configFile,
  JSON.stringify({
    malleable: { enabled: true, scopes: ['user'], capabilities: { 'export:download': 'deny' }, lockedSurfaces: ['inspector:context'] },
    distribution: { name: 'acme-replays', version: '2.0.0' },
  }),
);
const app = serveApp({ REPLAYS_CONFIG: configFile });

async function replayUrl(request: import('@playwright/test').APIRequestContext) {
  const base = app().origin;
  return `${base}/r/${await seedFailingReplay(request, base)}`;
}

test('the host policy: shown in the workshop, enforced by the keep dialog, the server and the broker', async ({ page, request }) => {
  const config = await (await request.get(`${app().origin}/api/config`)).json();
  expect(config).toMatchObject({
    distribution: { name: 'acme-replays', version: '2.0.0' },
    malleable: {
      scopes: ['user'],
      capabilities: { 'export:download': 'deny', 'comments:write': 'ask' },
      lockedSurfaces: ['inspector:context'],
    },
  });

  await openReplay(page, await replayUrl(request));
  await openWorkshop(page);
  await page.getByTestId('workshop-policy').locator('summary').click();
  await expect(page.getByTestId('policy-scopes')).toContainText('only you');
  await expect(page.getByTestId('policy-scopes')).not.toContainText('workspace');
  await expect(page.getByTestId('policy-capability:export:download')).toHaveAttribute('data-rule', 'deny');
  await expect(page.getByTestId('policy-capability:comments:write')).toHaveAttribute('data-rule', 'ask');
  await expect(page.getByTestId('policy-locked')).toContainText('inspector:context');
  await expect(page.getByTestId('policy-versions')).toContainText('acme-replays@2.0.0');

  await importPlugin(page, {
    manifest: manifestOf('csv-out', 'CSV out', ['replay:read', 'export:download'], { actions: [{ id: 'csv', label: 'Download CSV' }] }),
    source: `replays.action('csv', async (ctx) => { await ctx.download('n.csv', 'text/csv', 'a,b'); });`,
  });
  await expect(page.getByTestId('editor-title')).toHaveText('CSV out');
  // The keep dialog says so up front, offers only the allowed scope and cannot approve.
  await page.getByTestId('plugin-keep').click();
  await expect(page.getByTestId('keep-permissions')).toContainText('not allowed on this server');
  await expect(page.getByTestId('keep-policy')).toContainText('does not allow export:download');
  await expect(page.getByTestId('keep-scope').locator('option')).toHaveText(['Only me']);
  await expect(page.getByTestId('keep-approve')).toBeDisabled();
  await page.getByTestId('keep-cancel').click();
  // The server refuses it too, before any approval exists.
  const minted = await request.post(`${app().origin}/api/malleable/approvals`, {
    data: {
      action: 'save',
      scope: 'user',
      id: 'csv-out',
      manifest: manifestOf('csv-out', 'CSV out', ['export:download'], { actions: [{ id: 'csv', label: 'Download CSV' }] }),
      source: 'x',
    },
  });
  expect(minted.status()).toBe(403);
  await closeWorkshop(page);

  // As a draft it still loads, but the denied capability fails with permission-denied and asks nobody.
  let downloaded = false;
  page.on('download', () => {
    downloaded = true;
  });
  await openMore(page, 'plugin-action:user:csv-out:csv');
  await openWorkshop(page);
  await expect(page.getByTestId('diagnostics')).toContainText('this server does not allow export:download');
  await expect(page.getByTestId('permission-prompt')).toHaveCount(0);
  expect(downloaded).toBe(false);
});

test('after an upgrade, a plugin that fails to load gets a quiet "Review plugins" notice and stays on', async ({ page, request }) => {
  await openReplay(page, await replayUrl(request));
  await openWorkshop(page);
  await importPlugin(page, {
    manifest: manifestOf('brittle', 'Brittle tab', [], { tabs: [{ id: 'main', label: 'Brittle' }] }),
    source: `replays.tab('main', (el) => { if (!window.__thatOldApi) throw new Error('needs the old API'); });`,
  });
  await page.getByTestId('plugin-keep').click();
  await page.getByTestId('keep-approve').click();
  await expect(page.getByTestId('keep-dialog')).toHaveCount(0);
  const history = await (await request.get(`${app().origin}/api/malleable/plugins/user/brittle`)).json();
  expect(history.versions[0].manifest.targets).toMatchObject({ distribution: 'acme-replays@2.0.0' });
  expect(history.versions[0].manifest.targets.core).toMatch(/^\d+\.\d+\.\d+/);

  // This browser saw it load fine under the previous release.
  await page.evaluate((sha) => {
    localStorage.setItem(
      'replays-malleable-health',
      JSON.stringify({ '0.0.1 acme-replays@1.0.0': { brittle: { status: 'ok', sha, at: 1 } } }),
    );
  }, history.versions[0].sha256 as string);
  await page.reload();
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  await openWorkshop(page);
  await expect(page.getByTestId('review-plugins')).toHaveCount(0);
  await closeWorkshop(page);

  // Now it fails.
  await page.getByTestId('plugin:user:brittle:main-tab').click();
  await expect(panelFrame(page, 'plugin:user:brittle:main').locator('body')).toBeAttached();
  await openWorkshop(page);
  const notice = page.getByTestId('review-plugins');
  await expect(notice).toContainText('Review plugins');
  await expect(notice).toContainText('Brittle tab');
  await page.getByTestId('review-plugin:brittle').click();
  await expect(page.getByTestId('editor-title')).toHaveText('Brittle tab');
  await expect(page.getByTestId('diagnostics')).toContainText('needs the old API');
  // Nothing was switched off, changed or deleted.
  await expect(page.getByTestId(`plugin-origin:brittle`)).toHaveText('saved');
  const after = await (await request.get(`${app().origin}/api/malleable/plugins/user/brittle`)).json();
  expect(after.versions).toHaveLength(1);
  await page.getByTestId('review-dismiss').click();
  await expect(notice).toHaveCount(0);
  await closeWorkshop(page);
  await expect(page.getByTestId('plugin:user:brittle:main-tab')).toBeVisible();
});
