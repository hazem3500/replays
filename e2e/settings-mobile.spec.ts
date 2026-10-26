import { expect, test } from '@playwright/test';

import { origin } from './support.ts';

type Rect = { x: number; y: number; width: number; height: number };
type Box = Rect & { right: number; bottom: number };

function box(rect: Rect): Box {
  return { ...rect, right: rect.x + rect.width, bottom: rect.y + rect.height };
}

test.describe('touch phone settings', () => {
  test.use({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });

  test('keeps settings sections readable and usable on a touch phone', async ({ page }) => {
    await page.goto(origin());
    await page.getByRole('button', { name: 'Settings', exact: true }).tap();

    const dialog = page.getByRole('dialog', { name: 'Settings' });
    const tabList = dialog.getByRole('tablist', { name: 'Settings sections' });
    const panel = dialog.getByRole('tabpanel');
    await expect(dialog.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(tabList).toBeVisible();
    await expect(tabList.getByRole('tab', { name: 'Appearance' })).toBeVisible();
    await expect(tabList.getByRole('tab', { name: 'Agent access' })).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Color theme' })).toBeVisible();
    await page.screenshot({ path: '.review-artifacts/settings-mobile-390x800.png', fullPage: true });

    const appearanceGeometry = await page.evaluate(() => {
      const tabsRoot = document.querySelector<HTMLElement>('[data-slot="tabs"]')!;
      const tabListElement = tabsRoot.querySelector<HTMLElement>('[role="tablist"]')!;
      const panelElement = tabsRoot.querySelector<HTMLElement>('[role="tabpanel"]')!;
      const appearance = panelElement.querySelector<HTMLElement>('section[aria-labelledby="settings-appearance"]')!;
      const dialogElement = tabsRoot.closest<HTMLElement>('[role="dialog"]')!;
      return {
        flexDirection: getComputedStyle(tabsRoot).flexDirection,
        dialogWidth: dialogElement.getBoundingClientRect().width,
        tabList: tabListElement.getBoundingClientRect().toJSON(),
        panel: panelElement.getBoundingClientRect().toJSON(),
        appearance: appearance.getBoundingClientRect().toJSON(),
        appearanceClientWidth: appearance.clientWidth,
        appearanceScrollWidth: appearance.scrollWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        deviceScaleFactor: window.devicePixelRatio,
      };
    });
    appearanceGeometry.tabList = box(appearanceGeometry.tabList);
    appearanceGeometry.panel = box(appearanceGeometry.panel);
    appearanceGeometry.appearance = box(appearanceGeometry.appearance);
    expect(appearanceGeometry.flexDirection).toBe('column');
    expect(appearanceGeometry.tabList.bottom).toBeLessThanOrEqual(appearanceGeometry.panel.y + 1);
    expect(appearanceGeometry.panel.width).toBeGreaterThan(appearanceGeometry.dialogWidth * 0.85);
    expect(appearanceGeometry.appearanceClientWidth).toBeGreaterThan(300);
    expect(appearanceGeometry.appearanceScrollWidth).toBeLessThanOrEqual(appearanceGeometry.appearanceClientWidth + 1);
    expect(appearanceGeometry.documentScrollWidth).toBe(appearanceGeometry.viewportWidth);
    expect(appearanceGeometry.deviceScaleFactor).toBe(1);

    await tabList.getByRole('tab', { name: 'Agent access' }).tap();
    await expect(panel.getByRole('heading', { name: 'Connect an agent' })).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Agent credentials' })).toBeVisible();
    const agentGeometry = await panel.evaluate((element) => {
      const section = element.querySelector<HTMLElement>('section[aria-labelledby="settings-agent-access"]')!;
      const dialogElement = element.closest<HTMLElement>('[role="dialog"]')!;
      return {
        panelWidth: element.getBoundingClientRect().width,
        dialogWidth: dialogElement.getBoundingClientRect().width,
        sectionClientWidth: section.clientWidth,
        sectionScrollWidth: section.scrollWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    expect(agentGeometry.panelWidth).toBeGreaterThan(agentGeometry.dialogWidth * 0.85);
    expect(agentGeometry.sectionScrollWidth).toBeLessThanOrEqual(agentGeometry.sectionClientWidth + 1);
    expect(agentGeometry.documentScrollWidth).toBe(agentGeometry.viewportWidth);

    const close = dialog.locator('[data-slot="dialog-close"]');
    await expect(close).toBeVisible();
    await close.tap();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
  });
});

test.describe('desktop settings', () => {
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

  test('preserves the desktop settings sheet layout and keyboard close behavior', async ({ page }) => {
    await page.goto(origin());
    const trigger = page.getByRole('button', { name: 'Settings', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    const appearanceTab = dialog.getByRole('tab', { name: 'Appearance' });
    await expect(appearanceTab).toHaveAttribute('aria-selected', 'true');
    const appearancePanel = dialog.getByRole('tabpanel');
    await expect(appearancePanel.getByRole('heading', { name: 'Color theme' })).toBeVisible();
    const geometry = await dialog.evaluate((dialogElement) => {
      const tabsRoot = dialogElement.querySelector<HTMLElement>('[data-slot="tabs"]')!;
      const tabList = tabsRoot.querySelector<HTMLElement>('[role="tablist"]')!;
      const panel = tabsRoot.querySelector<HTMLElement>('[role="tabpanel"]')!;
      return {
        flexDirection: getComputedStyle(tabsRoot).flexDirection,
        dialog: dialogElement.getBoundingClientRect().toJSON(),
        tabList: tabList.getBoundingClientRect().toJSON(),
        panel: panel.getBoundingClientRect().toJSON(),
        panelClientWidth: panel.clientWidth,
        panelScrollWidth: panel.scrollWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    geometry.dialog = box(geometry.dialog);
    geometry.tabList = box(geometry.tabList);
    geometry.panel = box(geometry.panel);
    expect(geometry.flexDirection).toBe('column');
    expect(geometry.tabList.bottom).toBeLessThanOrEqual(geometry.panel.y + 1);
    expect(geometry.panel.width).toBeGreaterThan(geometry.dialog.width * 0.85);
    expect(geometry.panelClientWidth).toBeGreaterThan(450);
    expect(geometry.panelScrollWidth).toBeLessThanOrEqual(geometry.panelClientWidth + 1);
    expect(geometry.documentScrollWidth).toBe(geometry.viewportWidth);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
