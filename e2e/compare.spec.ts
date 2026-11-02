import { expect, type Page, test } from '@playwright/test';

import { openReplay, origin } from './support.ts';

const compareUrl = (layout = 'grid') => `${origin()}/r/demo-shop?with=human-demo&layout=${layout}`;

async function titleOf(page: Page, id: string) {
  const body: unknown = await (await page.request.get(`${origin()}/api/replays/${id}`)).json();
  const meta = typeof body === 'object' && body !== null && 'meta' in body ? body.meta : undefined;
  const title = typeof meta === 'object' && meta !== null && 'title' in meta ? meta.title : undefined;
  if (typeof title !== 'string') throw new Error(`${id} has no title`);
  return title;
}

/** Tags every tile's iframe, so a remount (a new iframe) is visible afterwards. */
async function markPlayers(page: Page) {
  await expect(page.locator('.ct-tile iframe')).toHaveCount(2);
  await page.locator('.ct-tile iframe').evaluateAll((frames) => {
    for (const frame of frames) frame.setAttribute('data-marked', '');
  });
}

test('a replay compares with another in its own viewer, each tile under its own title', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, compareUrl());
  const tiles = page.getByTestId('compare-stage').locator('.ct-tile');
  await expect(tiles).toHaveCount(2);
  await expect(tiles.nth(0).locator('.ct-name')).toHaveText(await titleOf(page, 'demo-shop'));
  await expect(tiles.nth(1).locator('.ct-name')).toHaveText(await titleOf(page, 'human-demo'));
  await expect(page.getByRole('group', { name: 'Playback controls' })).toHaveCount(1);
  await expect(page.getByRole('tablist', { name: 'Replay diagnostics' })).toBeVisible();
});

test('inspecting a tile scopes the title, inspector and URL to it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, compareUrl());
  const own = await titleOf(page, 'demo-shop');
  const other = await titleOf(page, 'human-demo');
  await page.getByRole('button', { name: `Show ${other} in the panels` }).click();
  await expect(page).toHaveURL(/focus=human-demo/);
  await expect(page.getByRole('heading', { level: 1, name: other })).toBeVisible();
  // why: two long titles do not fit as segments, so the scope is one menu naming the recording on show.
  const scope = page.getByTestId('compare-scope');
  await expect(scope).toContainText(other);
  await scope.getByRole('button', { name: `Showing ${other}. Choose another recording` }).click();
  await page.getByRole('menuitemradio', { name: own }).click();
  await expect(page).not.toHaveURL(/focus=/);
});

test('layouts glide the same players: Grid, Spotlight and Single never remount a tile', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, compareUrl());
  await markPlayers(page);
  const stage = page.getByTestId('compare-stage');
  await expect(stage).not.toHaveAttribute('data-resizing');
  const before = await stage.boundingBox();
  await stage.evaluate((element) => {
    element.addEventListener('transitionrun', (event) => {
      if (!(event instanceof TransitionEvent) || !(event.target instanceof HTMLElement)) return;
      if (event.target.matches('.ct-tile[data-current]') && event.propertyName === 'width') {
        element.setAttribute('data-gliding-tile', element.getAttribute('data-layout') ?? '');
      }
    });
  });
  const layouts = page.getByTestId('layout-switch');
  await layouts.getByRole('radio', { name: 'Spotlight' }).click();
  await expect(page).toHaveURL(/layout=spotlight/);
  await expect(page.locator('.ct-tile[data-role="spotlight"]')).toHaveAttribute('data-tile-id', 'demo-shop');
  await layouts.getByRole('radio', { name: 'Single' }).click();
  await expect(page).not.toHaveURL(/layout=/);
  await expect(page.locator('.ct-tile[data-role="single"]')).toHaveCount(1);
  await expect(stage).toHaveAttribute('data-gliding-tile', 'single');
  expect(await stage.boundingBox()).toEqual(before);
  await stage.evaluate((element) => element.removeAttribute('data-gliding-tile'));
  await layouts.getByRole('radio', { name: 'Grid' }).click();
  await expect(page.locator('.ct-tile[data-role="grid"]')).toHaveCount(2);
  await expect(stage).toHaveAttribute('data-gliding-tile', 'grid');
  expect(await stage.boundingBox()).toEqual(before);
  await expect
    .poll(() =>
      stage.evaluate(
        (element) =>
          [...element.querySelectorAll('.ct-tile')]
            .flatMap((tile) => tile.getAnimations())
            .filter((animation) => animation.playState === 'running').length,
      ),
    )
    .toBe(0);
  await expect(page.locator('.ct-tile iframe[data-marked]')).toHaveCount(2);
});

test('reduced motion switches comparison layouts immediately without replacing players', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, compareUrl());
  await markPlayers(page);
  await page.getByTestId('layout-switch').getByRole('radio', { name: 'Single' }).click();
  await expect(page.locator('.ct-tile[data-role="hidden"]')).toHaveAttribute('inert', '');
  await expect(page.locator('.ct-tile[data-role="single"]')).toHaveCSS('transition-duration', '0s');
  await page.getByTestId('layout-switch').getByRole('radio', { name: 'Grid' }).click();
  await expect(page.locator('.ct-tile[data-role="grid"]')).toHaveCount(2);
  await expect(page.locator('.ct-tile iframe[data-marked]')).toHaveCount(2);
});

test('the shared transport plays every recording from one clock', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, compareUrl());
  await page.keyboard.press('k');
  await expect(page.getByTestId('playhead')).not.toHaveText('0:00.0');
  await page.keyboard.press('k');
  const paused = await page.getByTestId('playhead').textContent();
  await page.waitForTimeout(300);
  await expect(page.getByTestId('playhead')).toHaveText(paused ?? '');
});

test('More adds a recording to compare, and Back returns to the replay alone', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, `${origin()}/r/demo-shop`);
  await expect(page.getByTestId('compare-with')).toHaveCount(0);
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByTestId('compare-with')).toHaveText('Compare with…');
  await page.getByTestId('compare-with').click();
  const picker = page.getByTestId('compare-picker');
  await picker.getByRole('button', { name: await titleOf(page, 'human-demo') }).click();
  await expect(page).toHaveURL(/\?with=human-demo&layout=grid$/);
  await expect(page.locator('.ct-tile')).toHaveCount(2);
  await page.goBack();
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  await expect(page.getByTestId('compare-stage')).toHaveCount(0);
});

test('removing the added recording leaves the replay on its own', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, compareUrl());
  const added = page.locator('.ct-tile[data-tile-id="human-demo"]');
  await added.hover();
  await added.getByTestId('tile-remove').click();
  await expect(page).not.toHaveURL(/with=/);
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
});

test('phones swipe through the compared recordings, the one in view in focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReplay(page, compareUrl());
  const stage = page.getByTestId('compare-stage');
  await expect(stage).toHaveAttribute('data-layout', 'carousel');
  await stage.evaluate((element) => element.scrollTo({ left: element.clientWidth, behavior: 'instant' }));
  await expect(page).toHaveURL(/focus=human-demo/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  // why: the phone top bar keeps its room for the title; the layout choice is in More.
  await expect(page.getByTestId('layout-switch')).toHaveCount(0);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByTestId('layout-single').click();
  await expect(page).not.toHaveURL(/layout=grid/);
});

test('tile actions stay quiet until the pointer rests on a tile', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, compareUrl());
  const actions = page.locator('.ct-tile[data-tile-id="human-demo"] .ct-actions');
  await expect(actions).toHaveCSS('opacity', '0');
  await page.locator('.ct-tile[data-tile-id="human-demo"]').hover();
  await expect(actions).toHaveCSS('opacity', '1');
});

/** Every tile on show lies inside the stage, and the stage ends where the steps rail begins. */
async function tilesClearOfTheRail(page: Page) {
  return page.evaluate(() => {
    const stage = document.querySelector('[data-testid="compare-stage"]')?.getBoundingClientRect();
    const rail = document.querySelector('.timeline-panel')?.getBoundingClientRect();
    if (!stage || !rail) return false;
    const tiles = [...document.querySelectorAll('.ct-tile:not([data-role="hidden"])')].map((tile) => tile.getBoundingClientRect());
    return stage.right <= rail.left + 1 && tiles.every((tile) => tile.left >= stage.left - 1 && tile.right <= stage.right + 1);
  });
}

test('tiles stay inside the stage, clear of the steps rail, at every width and layout', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, compareUrl());
  const layouts = page.getByTestId('layout-switch');
  for (const width of [1280, 1040, 880]) {
    await page.setViewportSize({ width, height: 800 });
    for (const layout of ['Spotlight', 'Grid']) {
      await layouts.getByRole('radio', { name: layout }).click();
      await expect.poll(() => tilesClearOfTheRail(page)).toBe(true);
    }
  }
});

test('on a phone the switch above the stage and the swipe always agree, and nothing sits on the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReplay(page, compareUrl());
  const stage = page.getByTestId('compare-stage');
  const options = page.getByTestId('phone-switch').getByRole('radio');
  await expect(options).toHaveCount(2);
  await expect(options.first()).toHaveAttribute('aria-checked', 'true');
  // why: the switch names the recording, so the page carries no name pill, error badge, floating button or frame.
  await expect(stage.locator('.ct-nametag').first()).toBeHidden();
  await expect(stage.locator('.ct-actions').first()).toBeHidden();
  await expect(page.locator('.stage-wrap .fullscreen-button')).toBeHidden();
  await expect(stage.locator('.ct-tile').first()).toHaveCSS('outline-style', 'none');

  await stage.evaluate((element) => element.scrollTo({ left: element.clientWidth, behavior: 'instant' }));
  await expect(options.nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(page).toHaveURL(/focus=human-demo/);

  await options.first().click();
  await expect(page).not.toHaveURL(/focus=/);
  await expect.poll(() => stage.evaluate((element) => Math.round(element.scrollLeft))).toBe(0);

  await options.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(options.nth(1)).toBeFocused();
  await expect.poll(() => stage.evaluate((element) => Math.round(element.scrollLeft / element.clientWidth))).toBe(1);
});
