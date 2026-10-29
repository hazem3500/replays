import { expect, test, type Locator, type Page } from '@playwright/test';

import { cloneBundle, openReplay, postBundle, serveApp, uniqueId } from './support.ts';

const server = serveApp();
const COUNT = 300;

async function seed(page: Page, id: string) {
  const bundle = await cloneBundle(page.request, server().origin, 'demo-shop', id, 'Windowed lists fixture');
  const url = 'https://shop.test/checkout';
  bundle.console = Array.from({ length: COUNT }, (_, index) => ({ at: index * 20, level: 'log', message: `tick ${index}`, url }));
  bundle.network = Array.from({ length: COUNT }, (_, index) => ({
    id: `poll-${index}`,
    at: index * 20,
    duration: 12,
    method: 'GET',
    url: `https://shop.test/api/poll?n=${index}`,
    status: 200,
    statusText: 'OK',
    requestHeaders: [],
    responseHeaders: [],
  }));
  bundle.performance = {
    supported: ['longtask'],
    entries: Array.from({ length: COUNT }, (_, index) => ({ at: 10 + index * 20, kind: 'long-task', value: 60 + (index % 7) * 30 })),
  };
  await postBundle(page.request, server().origin, bundle);
}

/** Scrolls the list's own scroller to its middle, so rows are windowed out above and below. */
async function scrollToMiddle(list: Locator) {
  await list.evaluate((element) => {
    let scroller: Element | null = element.querySelector('.list-spacer');
    while (scroller && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller.parentElement;
    scroller?.scrollTo({ top: (scroller.scrollHeight - scroller.clientHeight) / 2 });
  });
}

async function expectInertSpacers(list: Locator) {
  const spacers = list.locator('.list-spacer');
  await expect(spacers).toHaveCount(2);
  await expect.poll(() => spacers.evaluateAll((all) => all.filter((spacer) => spacer.getBoundingClientRect().height > 0).length)).toBe(2);
  const traits = await spacers.evaluateAll((all) =>
    all.map((spacer) => ({
      hidden: spacer.getAttribute('aria-hidden'),
      inert: (spacer as HTMLElement).inert,
      pointer: getComputedStyle(spacer).pointerEvents,
      role: spacer.getAttribute('role'),
      focusable: spacer.querySelector('button, a, [tabindex]') !== null,
    })),
  );
  for (const trait of traits) expect(trait).toEqual({ hidden: 'true', inert: true, pointer: 'none', role: null, focusable: false });
}

for (const [tab, list] of [
  ['console-tab', 'console-list'],
  ['network-tab', 'network-list'],
  ['performance-tab', 'performance-events'],
] as const) {
  test(`the ${list} windowing spacers are inert, never a blank hoverable row`, async ({ page }) => {
    const id = uniqueId('list-spacers');
    await seed(page, id);
    await page.setViewportSize({ width: 1280, height: 800 });
    await openReplay(page, `${server().origin}/r/${id}`);
    await page.getByTestId(tab).click();
    const target = page.getByTestId(list);
    await expect(target.locator('.list-spacer').first()).toBeAttached();
    await scrollToMiddle(target);
    await expectInertSpacers(target);
  });
}
