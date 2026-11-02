/*
 * Phone regression against the already-running shared Chromium (connectOverCDP; never launches a browser).
 * Run with SHARED_BROWSER_ENDPOINT and FILTER_SEARCH_ORIGIN set to the app URL from this Boat session.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('/home/hazem/.local/share/ozbox-browser/node_modules/playwright-core');

const endpoint = process.env.SHARED_BROWSER_ENDPOINT ?? 'http://127.0.0.1:9222';
const origin =
  process.env.FILTER_SEARCH_ORIGIN ??
  (process.env.FILTER_SEARCH_ORIGIN_FILE ? fs.readFileSync(process.env.FILTER_SEARCH_ORIGIN_FILE, 'utf8').trim() : undefined);
assert.ok(origin, 'Set FILTER_SEARCH_ORIGIN to this Boat preview URL, including its access token.');

async function nextTwoFrames(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function run() {
  const browser = await chromium.connectOverCDP(endpoint);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const results = [];

  try {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(origin, { waitUntil: 'domcontentloaded' });

      const filters = page.getByRole('button', { name: 'Filters', exact: true });
      await filters.tap();
      const sheet = page.locator('.filter-sheet');
      await sheet.waitFor({ state: 'visible' });
      await sheet.getByRole('button', { name: /^Host:/ }).tap();
      const selected = sheet.locator('[role="radio"][aria-checked="true"]');
      await selected.waitFor({ state: 'visible' });
      await nextTwoFrames(page);
      assert.equal(
        await selected.evaluate((element) => element === document.activeElement),
        true,
        `selected Host option receives focus at ${width}px`,
      );
      await page.waitForTimeout(1500);
      assert.equal(
        await selected.evaluate((element) => element === document.activeElement),
        true,
        `selected Host option keeps focus at ${width}px`,
      );

      await page.keyboard.press('Escape');
      await nextTwoFrames(page);
      const hostRow = sheet.getByRole('button', { name: /^Host:/ });
      assert.equal(
        await hostRow.evaluate((element) => element === document.activeElement),
        true,
        `Escape returns focus to Host at ${width}px`,
      );
      await sheet.getByRole('button', { name: 'Done', exact: true }).tap();
      await sheet.waitFor({ state: 'hidden' });

      const search = page.getByRole('combobox', { name: 'Search replays' });
      await search.focus();
      await search.fill('Demo');
      const close = page.getByRole('button', { name: 'Close search', exact: true });
      await close.waitFor({ state: 'visible' });
      const geometry = await page.evaluate(() => {
        const field = document.querySelector('.search-field.command-field').getBoundingClientRect();
        const closeBox = document.querySelector('.command-cancel').getBoundingClientRect();
        return {
          documentWidth: document.documentElement.scrollWidth,
          field: { left: field.left, right: field.right },
          close: { left: closeBox.left, right: closeBox.right },
        };
      });
      assert.ok(
        geometry.field.left >= 0 && geometry.field.right <= width,
        `search field stays inside ${width}px viewport: ${JSON.stringify(geometry)}`,
      );
      assert.ok(
        geometry.close.left >= 0 && geometry.close.right <= width,
        `Close search stays inside ${width}px viewport: ${JSON.stringify(geometry)}`,
      );
      assert.ok(geometry.documentWidth <= width, `no document overflow at ${width}px: ${JSON.stringify(geometry)}`);

      await page.keyboard.press('Escape');
      assert.equal(await search.getAttribute('aria-expanded'), 'false', `first Escape closes suggestions at ${width}px`);
      assert.equal(await search.inputValue(), 'Demo', `first Escape preserves the query at ${width}px`);
      await page.keyboard.press('Escape');
      assert.equal(await search.inputValue(), '', `second Escape clears the query at ${width}px`);
      assert.equal(
        await search.evaluate((element) => element === document.activeElement),
        true,
        `second Escape leaves search focused at ${width}px`,
      );

      await search.fill('Demo');
      await close.tap();
      assert.equal(await search.inputValue(), '', `Close search clears the query at ${width}px`);
      assert.equal(
        await search.evaluate((element) => element !== document.activeElement),
        true,
        `Close search blurs the field at ${width}px`,
      );
      results.push({
        width,
        geometry,
        selectedOptionFocusedAndStable: true,
        escapeReturnedFocus: true,
        searchFieldContained: true,
        closeContained: true,
        noHorizontalOverflow: true,
        keyboardAndCloseSemantics: true,
      });
    }
  } finally {
    await context.close();
    await browser.close();
  }

  assert.deepEqual(errors, [], 'no browser page errors');
  console.log(JSON.stringify({ results, pageErrors: errors }, null, 2));
}

run().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
