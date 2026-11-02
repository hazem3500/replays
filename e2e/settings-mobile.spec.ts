import { expect, test } from '@playwright/test';

import { origin } from './support.ts';

type Rect = { x: number; y: number; width: number; height: number };
type Box = Rect & { right: number; bottom: number };

function box(rect: Rect): Box {
  return { ...rect, right: rect.x + rect.width, bottom: rect.y + rect.height };
}

test.describe('touch phone settings', () => {
  test.use({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });

  test('shows CLI guidance directly without a redundant appearance section on a touch phone', async ({ page }) => {
    await page.goto(origin());
    await page.getByRole('button', { name: 'Settings', exact: true }).tap();

    const dialog = page.getByRole('dialog', { name: 'Settings' });
    const section = dialog.locator('section[aria-labelledby="settings-agent-access"]');
    await expect(dialog.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(section.getByRole('heading', { name: 'CLI & agent access' })).toBeVisible();
    await expect(dialog.getByRole('tablist')).toHaveCount(0);
    await expect(dialog.getByRole('radio')).toHaveCount(0);
    await expect(dialog.getByText('Color theme')).toHaveCount(0);
    await page.screenshot({ path: '.review-artifacts/settings-mobile-390x800.png' });

    const sectionGeometry = await section.evaluate((sectionElement) => {
      const scrollRegion = sectionElement.parentElement!;
      const dialogElement = sectionElement.closest<HTMLElement>('[role="dialog"]')!;
      return {
        scrollRegionHeight: scrollRegion.getBoundingClientRect().height,
        dialogWidth: dialogElement.getBoundingClientRect().width,
        dialogHeight: dialogElement.getBoundingClientRect().height,
        viewportHeight: window.innerHeight,
        sectionClientWidth: sectionElement.clientWidth,
        sectionScrollWidth: sectionElement.scrollWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        deviceScaleFactor: window.devicePixelRatio,
      };
    });
    expect(sectionGeometry.dialogHeight).toBeLessThanOrEqual(sectionGeometry.viewportHeight - 24);
    expect(sectionGeometry.scrollRegionHeight).toBeGreaterThan(200);
    expect(sectionGeometry.sectionClientWidth).toBeGreaterThan(300);
    expect(sectionGeometry.sectionScrollWidth).toBeLessThanOrEqual(sectionGeometry.sectionClientWidth + 1);
    expect(sectionGeometry.documentScrollWidth).toBe(sectionGeometry.viewportWidth);
    expect(sectionGeometry.deviceScaleFactor).toBe(1);

    await section.locator('details summary').tap();
    await expect(section.getByRole('heading', { name: 'Agent credentials' })).toBeVisible();
    await expect(section.getByText('Credential creation isn’t enabled for this deployment.')).toBeVisible();
    await page.screenshot({ path: '.review-artifacts/settings-agent-mobile-390x800.png' });

    const close = dialog.locator('[data-slot="dialog-close"]');
    await expect(close).toBeVisible();
    await close.tap();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
  });
});

test.describe('agent access capability states', () => {
  test.use({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });

  test('uses the active auth mode and only exposes credential creation when supported', async ({ page }) => {
    await page.route('**/api/config', (route) => route.fulfill({ json: { auth: 'session' } }));
    await page.route('**/api/agent-capabilities', (route) =>
      route.fulfill({ json: { credentials: { enabled: true, scopes: ['replays:read'], maxExpirySeconds: 86400 } } }),
    );
    await page.route('**/api/agent-credentials', (route) => route.fulfill({ json: { credentials: [] } }));
    await page.goto(origin());
    await page.getByRole('button', { name: 'Settings', exact: true }).tap();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    const section = dialog.locator('section[aria-labelledby="settings-agent-access"]');
    await expect(section.getByText('Host-managed sign-in · this deployment does not advertise CLI device login.')).toBeVisible();
    await expect(section.locator('pre code').last()).toContainText('--header-file headers.json');
    await section.locator('details summary').tap();
    await expect(section.getByRole('button', { name: 'New credential' })).toBeVisible();
    await expect(section.getByText(/Restricted to these scopes/)).toBeVisible();
  });

  test('keeps open-access command free of credential instructions', async ({ page }) => {
    await page.route('**/api/config', (route) => route.fulfill({ json: { auth: 'none' } }));
    await page.route('**/api/agent-capabilities', (route) => route.fulfill({ status: 404 }));
    await page.goto(origin());
    await page.getByRole('button', { name: 'Settings', exact: true }).tap();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    const section = dialog.locator('section[aria-labelledby="settings-agent-access"]');
    await expect(section.getByText('Open access · use only on a trusted network.')).toBeVisible();
    for (const command of await section.locator('pre code').all()) await expect(command).not.toContainText('--header-file');
    await section.locator('details summary').tap();
    await expect(section.getByText('Credential creation isn’t enabled for this deployment.')).toBeVisible();
  });
});

test.describe('desktop settings', () => {
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

  test('keeps the direct CLI settings sheet usable on desktop and preserves keyboard close behavior', async ({ page }) => {
    await page.goto(origin());
    const trigger = page.getByRole('button', { name: 'Settings', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    const section = dialog.locator('section[aria-labelledby="settings-agent-access"]');
    await expect(section.getByRole('heading', { name: 'CLI & agent access' })).toBeVisible();
    await expect(dialog.getByRole('tablist')).toHaveCount(0);
    await expect(dialog.getByRole('radio')).toHaveCount(0);
    const geometry = await dialog.evaluate((dialogElement) => {
      const sectionElement = dialogElement.querySelector<HTMLElement>('section[aria-labelledby="settings-agent-access"]')!;
      const scrollRegion = sectionElement.parentElement!;
      return {
        dialog: dialogElement.getBoundingClientRect().toJSON(),
        scrollRegion: scrollRegion.getBoundingClientRect().toJSON(),
        sectionClientWidth: sectionElement.clientWidth,
        sectionScrollWidth: sectionElement.scrollWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    geometry.dialog = box(geometry.dialog);
    geometry.scrollRegion = box(geometry.scrollRegion);
    expect(geometry.scrollRegion.width).toBeGreaterThan(geometry.dialog.width * 0.85);
    expect(geometry.sectionClientWidth).toBeGreaterThan(450);
    expect(geometry.sectionScrollWidth).toBeLessThanOrEqual(geometry.sectionClientWidth + 1);
    expect(geometry.documentScrollWidth).toBe(geometry.viewportWidth);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
