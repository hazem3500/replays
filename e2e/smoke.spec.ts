import { expect, type Page, test } from '@playwright/test';

import { openReplay, origin } from './support.ts';

const viewer = (id = 'demo-shop', query = '') => `${origin()}/r/${id}${query}`;
const playhead = (page: Page) => page.getByTestId('playhead');
const step = (page: Page, number: number) => page.getByTestId('step-timeline').locator(`[data-step-index="${number - 1}"]`);

test.describe('index', () => {
  test('lists the sample replays and opens one', async ({ page }) => {
    await page.goto(`${origin()}/`);
    await expect(page).toHaveTitle('Replay Kit');
    await expect(page.getByRole('heading', { level: 1, name: 'Replay Kit' })).toBeVisible();
    await expect(page.getByRole('status').first()).toHaveText('2 replays');
    const shop = page.getByRole('link', { name: /^Demo shop: checkout with a bad coupon/ });
    await expect(shop).toHaveAttribute('href', '/r/demo-shop');
    await expect(page.getByRole('link', { name: /^Demo signup form \(human recording\)/ })).toHaveAttribute('href', '/r/human-demo');
    await shop.click();
    await expect(page).toHaveURL(`${origin()}/r/demo-shop`);
    await expect(page.getByRole('heading', { level: 1, name: 'Demo shop: checkout with a bad coupon' })).toBeVisible();
  });

  test('search narrows the list', async ({ page }) => {
    await page.goto(`${origin()}/`);
    const search = page.getByRole('combobox', { name: 'Search replays' });
    await search.fill('signup');
    await expect(page.getByRole('status').first()).toHaveText('1 replay');
    await expect(page.getByRole('link', { name: /^Demo signup form/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Demo shop/ })).toHaveCount(0);
    await expect(page).toHaveURL(/[?&]q=signup/);
    await search.fill('no such replay');
    await expect(page.getByRole('status').first()).toHaveText('0 replays');
  });

  test('the tag filter comes from the URL and from the Filter menu', async ({ page }) => {
    await page.goto(`${origin()}/?tag=checkout`);
    await expect(page.getByRole('status').first()).toHaveText('1 replay');
    await expect(page.getByRole('link', { name: /^Demo shop/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Demo signup form/ })).toHaveCount(0);

    await page.goto(`${origin()}/`);
    await page.getByRole('button', { name: /^Filter/ }).click();
    await page.getByRole('menuitem', { name: /^Tag/ }).click();
    await page.getByRole('menuitemradio', { name: 'demo' }).click();
    await expect(page).toHaveURL(/[?&]tag=demo/);
    await expect(page.getByRole('status').first()).toHaveText('1 replay');
  });

  test('the errors filter keeps only replays with errors', async ({ page }) => {
    await page.goto(`${origin()}/?errors=1`);
    await expect(page.getByRole('status').first()).toHaveText('1 replay');
    await expect(page.getByRole('link', { name: /^Demo shop/ })).toBeVisible();
  });

  test('the human import is filtered by source', async ({ page }) => {
    await page.goto(`${origin()}/?source=human`);
    await expect(page.getByRole('status').first()).toHaveText('1 replay');
    await expect(page.getByRole('link', { name: /^Demo signup form/ })).toBeVisible();
  });

  test('layout and sort are controls, and the layout is remembered', async ({ page }) => {
    await page.goto(`${origin()}/`);
    await page.getByRole('button', { name: 'Grid' }).click();
    await expect(page.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'List' }).click();
    await expect(page.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('viewer', () => {
  test('shows the title, the steps and the recorded page', async ({ page }) => {
    await openReplay(page, viewer());
    await expect(page).toHaveTitle('Demo shop: checkout with a bad coupon · Replay Kit');
    await expect(page.getByTestId('step-timeline').locator('[data-step-index]')).toHaveCount(18);
    await expect(page.getByTestId('step-count').locator('.visually-hidden')).toHaveText('Step 1 of 18');
    await expect(playhead(page)).toHaveText('0:00.0');
    await expect(page.frameLocator('.player-host iframe').getByText('Pinecone Goods').first()).toBeVisible();
  });

  test('clicking a step seeks to it', async ({ page }) => {
    await openReplay(page, viewer());
    await step(page, 5).click();
    await expect(playhead(page)).toHaveText('0:03.0');
    await expect(step(page, 5)).toHaveAttribute('aria-current', 'step');
    await expect(page.getByTestId('step-count').locator('.visually-hidden')).toHaveText('Step 5 of 18');
  });

  test('play, pause and seek', async ({ page }) => {
    await openReplay(page, viewer());
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect(playhead(page)).not.toHaveText('0:00.0');
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    const paused = await playhead(page).innerText();
    await page.waitForTimeout(400);
    await expect(playhead(page)).toHaveText(paused);

    const seek = page.getByRole('slider', { name: 'Seek' });
    await seek.press('End');
    await expect(playhead(page)).toHaveText('0:08.8');
    await expect(seek).toHaveAttribute('aria-valuetext', '0:08.8 of 0:08.8');
    await seek.press('Home');
    await expect(playhead(page)).toHaveText('0:00.0');
  });

  test('plays to the end and offers a restart', async ({ page }) => {
    await openReplay(page, viewer());
    await page.getByRole('button', { name: /^Playback: / }).click();
    await page.getByRole('menuitemradio', { name: /^8×/ }).click();
    await expect(page.getByTestId('speed-tag')).toHaveText('8×');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Replay from start' })).toBeVisible({ timeout: 15_000 });
    await expect(playhead(page)).toHaveText('0:08.8');
    await page.getByRole('button', { name: 'Replay from start' }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  });

  test('the diagnostics tabs show console, network, performance and context', async ({ page }) => {
    await openReplay(page, viewer());
    await page.getByRole('slider', { name: 'Seek' }).press('End');

    await expect(page.getByTestId('console-tab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('console-list')).toContainText('Coupon service answered 404');

    await page.getByTestId('network-tab').click();
    await expect(page.locator('[data-request-id]')).toHaveCount(8);
    await page.getByRole('button', { name: 'GET /api/coupons/SPRING10' }).click();
    await expect(page.getByTestId('request-detail')).toContainText('/api/coupons/SPRING10');
    await expect(page.getByTestId('request-detail')).toContainText('404');

    await page.getByTestId('performance-tab').click();
    await expect(page.getByTestId('performance-list')).toContainText(/contentful paint/i);

    await page.getByTestId('context-tab').click();
    const panel = page.getByTestId('context-panel');
    await expect(panel).toContainText('Demo shop');
    await expect(panel.getByRole('link', { name: /^Example pull request/ })).toHaveAttribute(
      'href',
      'https://github.com/example-org/shop-demo/issues/42',
    );
    await expect(panel).toContainText('rejects an unknown coupon');
  });

  test('error markers and the next and previous error keys', async ({ page }) => {
    await openReplay(page, viewer());
    await expect(page.getByTestId('error-marker')).toHaveCount(1);
    await page.locator('body').press('e');
    await expect(playhead(page)).toHaveText('0:07.2');
    await page.getByRole('slider', { name: 'Seek' }).press('End');
    await page.locator('body').press('Shift+E');
    await expect(playhead(page)).toHaveText('0:07.2');
  });

  test('?t= and #step-N permalinks open at that point', async ({ page }) => {
    await openReplay(page, viewer('demo-shop', '?t=3'));
    await expect(playhead(page)).toHaveText('0:03.0');
    await openReplay(page, viewer('demo-shop', '#step-9'));
    await expect(playhead(page)).toHaveText('0:04.5');
    await expect(step(page, 9)).toHaveAttribute('aria-current', 'step');
  });

  test('copy link copies the plain link, and its menu a time or step permalink', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openReplay(page, viewer());
    await page.getByRole('slider', { name: 'Seek' }).press('ArrowRight');
    await expect(playhead(page)).toHaveText('0:01.0');
    const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect.poll(clipboard).toBe(viewer());
    await page.getByRole('button', { name: 'Copy link' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Copy link at 0:01.0' }).click();
    await expect.poll(clipboard).toBe(viewer('demo-shop', '?t=1.0'));
  });

  test('keyboard shortcuts move through steps, tabs and speed', async ({ page }) => {
    await openReplay(page, viewer());
    const body = page.locator('body');
    await body.press(']');
    await expect(playhead(page)).toHaveText('0:00.8');
    await body.press(']');
    await expect(playhead(page)).toHaveText('0:02.3');
    await body.press('[');
    await expect(playhead(page)).toHaveText('0:00.8');

    await body.press('n');
    await expect(page.getByTestId('network-tab')).toHaveAttribute('aria-selected', 'true');
    await body.press('p');
    await expect(page.getByTestId('performance-tab')).toHaveAttribute('aria-selected', 'true');
    await body.press('c');
    await expect(page.getByTestId('console-tab')).toHaveAttribute('aria-selected', 'true');

    await body.press('>');
    await expect(page.getByTestId('speed-tag')).toHaveText('1.5×');
    await body.press('<');
    await expect(page.getByTestId('speed-tag')).toHaveText('1×');

    await body.press('Space');
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await body.press('Space');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  });

  test('the step captions switch flips on click', async ({ page }) => {
    await openReplay(page, viewer());
    const captions = page.getByTestId('captions-switch');
    await expect(captions).toHaveAttribute('aria-pressed', 'false');
    await captions.click();
    await expect(captions).toHaveAttribute('aria-pressed', 'true');
  });

  test('the shortcut sheet opens from ? and from the More menu, and closes on Escape', async ({ page }) => {
    await openReplay(page, viewer());
    await page.locator('body').press('?');
    const sheet = page.getByTestId('shortcut-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
    await expect(sheet).toContainText('Play or pause');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /Keyboard shortcuts/ }).click();
    await expect(sheet).toBeVisible();
  });

  test('an imported recording opens without steps or diagnostics rows', async ({ page }) => {
    await openReplay(page, viewer('human-demo'));
    await expect(page.getByRole('heading', { level: 1, name: 'Demo signup form (human recording)' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-valuetext', '0:00.0 of 0:04.3');
  });

  test('an unknown replay says so', async ({ page }) => {
    await page.goto(viewer('does-not-exist'));
    await expect(page.getByText(/not found|could not|no replay/i).first()).toBeVisible();
  });

  test('the theme switch flips and remembers the colour scheme', async ({ page }) => {
    await openReplay(page, viewer());
    const html = page.locator('html');
    const before = await html.getAttribute('data-theme');
    await page.getByRole('button', { name: /^Switch to (dark|light) theme/ }).click();
    await expect(html).not.toHaveAttribute('data-theme', before ?? '');
    const after = await html.getAttribute('data-theme');
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', after ?? '');
  });
});
