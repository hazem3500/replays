import { expect, type Page, test } from '@playwright/test';

import { origin } from './support.ts';

async function openSettings(page: Page, tap: boolean) {
  const trigger = page.getByRole('button', { name: 'Settings', exact: true });
  await (tap ? trigger.tap() : trigger.click());
  return page.getByRole('dialog', { name: 'Settings' });
}

function overflow(page: Page) {
  return page.evaluate(async () => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) throw new Error('the Settings dialog is not open');
    await Promise.all(dialog.getAnimations({ subtree: true }).map((animation) => animation.finished));
    const rect = dialog.getBoundingClientRect();
    return {
      dialog: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      dialogOverflow: dialog.scrollWidth - dialog.clientWidth,
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

test.describe('touch phone settings', () => {
  test.use({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });

  test('opens a full-screen section list that pushes one section and goes back', async ({ page }) => {
    await page.goto(origin());
    const dialog = await openSettings(page, true);
    const nav = dialog.getByRole('navigation', { name: 'Settings sections' });
    await expect(nav.getByRole('button')).toHaveText(['CLI & agents', 'Keyboard', 'Labs', 'About']);
    await expect(dialog.getByRole('radio')).toHaveCount(0);

    const geometry = await overflow(page);
    expect(geometry.dialog).toEqual({ x: 0, y: 0, width: geometry.viewport.width, height: geometry.viewport.height });
    expect(geometry.documentOverflow).toBe(0);

    await nav.getByRole('button', { name: 'CLI & agents' }).tap();
    const back = dialog.getByRole('button', { name: 'Back to settings' });
    await expect(back).toBeFocused();
    await expect(dialog.getByRole('heading', { name: 'CLI & agents' })).toBeVisible();
    const setup = dialog.getByRole('textbox', { name: 'Server setup command' });
    await expect(setup).toHaveJSProperty('readOnly', true);
    const field = await setup.evaluate((input: HTMLInputElement) => ({ client: input.clientWidth, scroll: input.scrollWidth }));
    expect(field.scroll).toBeGreaterThan(field.client);
    expect((await overflow(page)).dialogOverflow).toBe(0);

    await page.keyboard.press('Escape');
    await expect(nav.getByRole('button', { name: 'CLI & agents' })).toBeFocused();
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Close settings' }).tap();
    await expect(dialog).toBeHidden();
  });
});

test.describe('agent access capability states', () => {
  test.use({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });

  test('uses the active auth mode and only offers credential creation when supported', async ({ page }) => {
    await page.route('**/api/config', (route) => route.fulfill({ json: { auth: 'session', name: 'Replays', sourceProviders: [] } }));
    await page.route('**/api/agent-capabilities', (route) =>
      route.fulfill({ json: { credentials: { enabled: true, scopes: ['replays:read'], maxExpirySeconds: 86400 } } }),
    );
    await page.route('**/api/agent-credentials', (route) => route.fulfill({ json: { credentials: [] } }));
    await page.goto(origin());
    const dialog = await openSettings(page, true);
    await dialog.getByRole('button', { name: 'CLI & agents' }).tap();
    await expect(dialog.getByText('Host-managed sign-in · no CLI device login.')).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Upload command' })).toHaveValue(/--header-file headers\.json/);
    await expect(dialog.getByRole('button', { name: 'New credential' })).toBeVisible();
  });

  test('keeps the open-access commands free of credential instructions', async ({ page }) => {
    await page.route('**/api/config', (route) => route.fulfill({ json: { auth: 'none', name: 'Replays', sourceProviders: [] } }));
    await page.route('**/api/agent-capabilities', (route) => route.fulfill({ status: 404 }));
    await page.goto(origin());
    const dialog = await openSettings(page, true);
    await dialog.getByRole('button', { name: 'CLI & agents' }).tap();
    await expect(dialog.getByText('Open access · use only on a trusted network.')).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Upload command' })).toHaveValue('replays upload replay.json');
    await expect(dialog.getByText('Credential creation isn’t enabled for this deployment.')).toBeVisible();
  });
});

test.describe('desktop settings', () => {
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

  test('keeps one dialog size across sections and returns focus on Escape', async ({ page }) => {
    await page.goto(origin());
    const dialog = await openSettings(page, false);
    const tabs = dialog.getByRole('tablist', { name: 'Settings sections' });
    await expect(tabs.getByRole('tab', { name: 'CLI & agents' })).toBeFocused();
    const sizes = new Set<string>();
    const sections: ReadonlyArray<readonly [name: string, id: string]> = [
      ['CLI & agents', 'cli'],
      ['Keyboard', 'keyboard'],
      ['Labs', 'labs'],
      ['About', 'about'],
    ];
    for (const [name, id] of sections) {
      await tabs.getByRole('tab', { name }).click();
      await expect(dialog.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', `settings-tab-${id}`);
      const geometry = await overflow(page);
      expect(geometry.dialogOverflow).toBe(0);
      expect(geometry.documentOverflow).toBe(0);
      sizes.add(`${geometry.dialog.width}x${geometry.dialog.height}`);
    }
    expect(sizes.size).toBe(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
  });
});
