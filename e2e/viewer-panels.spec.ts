import { expect, test } from '@playwright/test';

import { cloneBundle, openReplay, postBundle, uniqueId, serveApp } from './support.ts';

const server = serveApp();

test('performance signals follow the playhead and open with the P key', async ({ page }) => {
  const id = uniqueId('performance');
  const bundle = await cloneBundle(page.request, server().origin, 'demo-shop', id, 'Performance fixture');
  bundle.performance = {
    supported: ['paint', 'longtask', 'event'],
    entries: [
      { at: 500, kind: 'first-contentful-paint', value: 500 },
      { at: 5000, kind: 'long-task', value: 72 },
      { at: 8000, kind: 'slow-interaction', value: 96, eventType: 'click' },
    ],
  };
  await postBundle(page.request, server().origin, bundle);

  await openReplay(page, `${server().origin}/r/${id}`);
  await page.getByTestId('step-timeline').locator('[data-step-index="1"]').click();
  await page.getByTestId('performance-tab').click();
  // Captured event rows share the player; future observations remain explicit.
  await expect(page.getByTestId('performance-tab')).toHaveAccessibleName('Performance, 1 of 3 signals reached');
  const events = page.getByTestId('performance-events');
  const rows = events.getByRole('button');
  await expect(rows).toHaveCount(3);
  await expect(events.locator('[data-future]')).toHaveCount(2);
  await expect(rows.first()).toContainText(/contentful paint/i);
  await expect(rows.first()).toContainText('500 ms');
  await expect(rows.nth(1)).toContainText('Upcoming');

  await rows.nth(1).click();
  await expect(page.getByTestId('playhead')).toHaveText('0:05.0');
  await expect(page.getByTestId('performance-tab')).toHaveAccessibleName('Performance, 2 of 3 signals reached');
  await expect(events.locator('[data-future]')).toHaveCount(1);
  const evidence = page.getByRole('region', { name: 'Selected performance evidence' });
  await expect(evidence.locator('.perf-facts')).toContainText('Captured duration72 ms');
  await rows.nth(1).press('ArrowDown');
  await expect(page.getByTestId('playhead')).toHaveText('0:08.0');
  await expect(rows.nth(2)).toBeFocused();
  await expect(evidence.locator('h2')).toHaveText('Slow interaction · click');
  await expect(evidence).toContainText('96 ms');
  await expect(evidence).toContainText('Time from input to the next paint');
  await page.keyboard.press('Escape');
  await expect(evidence).toBeHidden();
  await expect(rows.nth(2)).toBeFocused();

  await page.getByRole('button', { name: 'Paints', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('nav.');
  await rows.first().click();
  await expect(evidence.locator('.perf-facts')).toContainText('Since navigation500 ms');
  await expect(evidence.locator('.perf-raw')).not.toHaveAttribute('open');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'All', exact: true }).click();

  await page.getByTestId('console-tab').click();
  await page.keyboard.press('p');
  await expect(page.getByTestId('performance-tab')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('slider', { name: 'Seek' }).press('End');
  await expect(page.getByTestId('performance-tab')).toHaveAccessibleName('Performance, 3 of 3 signals reached');
  await expect(events.locator('[data-future]')).toHaveCount(0);
  await expect(rows.nth(2)).toContainText('click');
  await page.getByRole('slider', { name: 'Seek' }).press('Home');
  await expect(page.getByTestId('performance-tab')).toHaveAccessibleName('Performance, 0 of 3 signals reached');
  await expect(events.locator('[data-future]')).toHaveCount(3);
});

test('performance virtualization keeps row and clock offsets aligned across responsive resize', async ({ page }) => {
  const id = uniqueId('performance-virtualized');
  const bundle = await cloneBundle(page.request, server().origin, 'demo-shop', id);
  bundle.performance = {
    supported: ['longtask'],
    entries: Array.from({ length: 120 }, (_, index) => ({ at: 10 + index * 8, kind: 'long-task', value: 2 + (index % 4) })),
  };
  await postBundle(page.request, server().origin, bundle);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, `${server().origin}/r/${id}`);
  await page.getByTestId('performance-tab').click();

  const events = page.getByTestId('performance-events');
  const panel = page.getByTestId('performance-diagnostics');
  const row = (index: number) => events.locator(`[data-performance-id="performance-${index}"]`);
  const assertWindowAt = async (index: number, rowHeight: number) => {
    await expect(panel).toHaveAttribute('data-row-height', String(rowHeight));
    await events.evaluate(
      (element, top) => {
        element.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true }));
        element.scrollTop = top;
      },
      index * rowHeight + 28,
    );
    await expect(row(index)).toBeAttached();
    await row(index).evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await expect(row(index)).toBeInViewport();
    const visible = await events
      .locator('.perf-event')
      .evaluateAll((elements) => elements.map((element) => Number((element as HTMLElement).dataset.performanceId?.split('-').at(-1))));
    expect(visible.length).toBeLessThan(120);
    expect(visible).toContain(index);
    expect(visible).toContain(index + 1);
    await expect(row(index)).toHaveCSS('height', `${rowHeight}px`);
  };
  const assertDividerAfterSelected = async (index: number, rowHeight: number) => {
    await row(index).click();
    await expect(row(index)).toHaveAttribute('aria-expanded', 'true');
    const visibleOffset = 28 + (index + 1) * rowHeight - 100;
    await events.evaluate((element, top) => {
      element.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true }));
      element.scrollTop = top;
    }, visibleOffset);
    await expect.poll(() => events.evaluate((element) => element.scrollTop)).toBe(visibleOffset);
    const alignment = await events.evaluate((element, nextIndex) => {
      const divider = element.querySelector<HTMLElement>('[data-testid="now-divider"]');
      const next = element.querySelector<HTMLElement>(`[data-performance-id="performance-${nextIndex}"]`);
      return {
        reached: Number(divider?.dataset.reached),
        dividerTop: divider?.getBoundingClientRect().top,
        nextTop: next?.getBoundingClientRect().top,
      };
    }, index + 1);
    expect(alignment.reached).toBe(index + 1);
    expect(alignment.nextTop).toBeDefined();
    expect(alignment.dividerTop).toBeDefined();
    expect(Math.abs(alignment.nextTop! - alignment.dividerTop!)).toBeLessThanOrEqual(1);
    await expect(row(index)).toBeFocused();
    await row(index).press('ArrowDown');
    await expect(row(index + 1)).toBeFocused();
    await expect(row(index + 1)).toHaveAttribute('aria-expanded', 'true');
    await expect(row(index + 1)).toHaveCSS('height', `${rowHeight}px`);
  };

  await assertWindowAt(60, 32);
  await assertDividerAfterSelected(60, 32);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Selected performance evidence' })).toBeHidden();
  await events.evaluate((element) => {
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true }));
    element.scrollTop = element.scrollHeight;
  });
  await expect(row(119)).toBeAttached();
  await row(119).evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expect(row(119)).toBeInViewport();

  await page.setViewportSize({ width: 390, height: 800 });
  await assertWindowAt(60, 44);
  await assertDividerAfterSelected(60, 44);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Selected performance evidence' })).toBeHidden();
  await events.evaluate((element) => {
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true }));
    element.scrollTop = element.scrollHeight;
  });
  await expect(row(119)).toBeAttached();
  await row(119).evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expect(row(119)).toBeInViewport();
});

test.describe('Performance on a phone', () => {
  test.use({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });

  test('keeps timing columns within their rows and evidence scrollable at 390px', async ({ page }) => {
    const id = uniqueId('performance-phone');
    const bundle = await cloneBundle(page.request, server().origin, 'demo-shop', id);
    bundle.steps = [{ at: 1800, kind: 'click', label: 'Open project with a long captured action label' }];
    bundle.performance = {
      supported: ['paint', 'longtask', 'event'],
      entries: [
        { at: 1700, kind: 'slow-interaction', value: 420, eventType: 'pointerdown' },
        { at: 1900, kind: 'long-task', value: 182 },
        { at: 2400, kind: 'first-contentful-paint', value: 196 },
        { at: 2500, kind: 'largest-contentful-paint', value: 196 },
        { at: 3000, kind: 'slow-interaction', value: 0, eventType: 'beforeinput' },
      ],
    };
    await postBundle(page.request, server().origin, bundle);
    await openReplay(page, `${server().origin}/r/${id}`);
    await page.getByTestId('performance-tab').tap();
    const panel = page.getByTestId('performance-diagnostics');
    const events = page.getByTestId('performance-events');
    await expect(events.locator('.perf-event')).toHaveCount(5);
    await expect(events.locator('.perf-replay-compact')).toBeVisible();
    await expect(events.locator('.perf-replay-wide')).toBeHidden();

    const assertGeometry = async () => {
      const geometry = await panel.evaluate((element) => {
        const header = element.querySelector<HTMLElement>('.perf-event-columns')!;
        const headerBox = header.getBoundingClientRect();
        const rows = [...element.querySelectorAll<HTMLElement>('.perf-events .perf-event')];
        // The helper must remain inside the serialized browser evaluation.
        // oxlint-disable-next-line unicorn/consistent-function-scoping
        function within(inner: DOMRect, outer: DOMRect) {
          return (
            inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1
          );
        }
        return {
          overflow: [element, ...element.querySelectorAll<HTMLElement>('.perf-events, .perf-main, .perf-detail')].some(
            (node) => node.scrollWidth > node.clientWidth + 1,
          ),
          headerHeight: headerBox.height,
          headerFits: [...header.children].every(
            (cell) => !cell.getBoundingClientRect().width || within(cell.getBoundingClientRect(), headerBox),
          ),
          rowsFit: rows.every((row) => {
            const box = row.getBoundingClientRect();
            return (
              box.height >= 43 &&
              [...row.children].every((cell) => !cell.getBoundingClientRect().width || within(cell.getBoundingClientRect(), box))
            );
          }),
        };
      });
      expect(geometry).toEqual({ overflow: false, headerHeight: 28, headerFits: true, rowsFit: true });
    };
    await assertGeometry();
    await events.locator('[data-performance-id="performance-0"]').tap();
    const evidence = page.getByRole('region', { name: 'Selected performance evidence' });
    await expect(evidence.locator('h2')).toHaveText('Slow interaction · pointerdown');
    await expect(evidence.locator('.perf-facts')).toContainText('Captured duration420 ms');
    await expect(evidence.locator('[data-performance-id="action-0"]')).toBeAttached();
    await assertGeometry();
    const evidenceSize = await evidence.boundingBox();
    const eventsSize = await events.boundingBox();
    expect(evidenceSize!.height).toBeGreaterThan(eventsSize!.height);
    await evidence.focus();
    await page.keyboard.press('Escape');
    await expect(evidence).toBeHidden();
    await expect(events.locator('[data-performance-id="performance-0"]')).toBeFocused();
    await expect(events.locator('.now-grip')).toHaveAttribute('role', 'slider');
  });
});

test('an imported recording has an empty Context tab', async ({ page }) => {
  await openReplay(page, `${server().origin}/r/human-demo`);
  await expect(page.getByTestId('console-tab')).toBeVisible();
  await page.getByTestId('context-tab').click();
  await expect(page.getByTestId('context-empty')).toBeVisible();
});

test('context fields render without a schema: humanized keys, Yes/No, chips, nested lists, text URLs', async ({ page }) => {
  const id = uniqueId('fields');
  const bundle = await cloneBundle(page.request, server().origin, 'demo-shop', id, 'Context fields fixture');
  bundle.context = {
    version: 1,
    capturedAt: '2026-10-10T12:00:00.000Z',
    fields: {
      release_channel: 'beta',
      isInternal: true,
      labels: ['alpha', 'beta'],
      owner: { team_name: 'Core', on_call: false },
      ticket_url: 'https://example.com/tickets/7',
    },
  };
  await postBundle(page.request, server().origin, bundle);

  await openReplay(page, `${server().origin}/r/${id}`);
  await page.getByTestId('context-tab').click();
  const fields = page.getByTestId('context-fields');
  const row = (label: string) => fields.locator('.ctx-row', { has: page.locator('.ctx-label', { hasText: new RegExp(`^${label}$`) }) });
  await expect(row('Release channel')).toContainText('beta');
  await expect(row('Is internal')).toContainText('Yes');
  await expect(row('Labels').locator('.ctx-chip')).toHaveText(['alpha', 'beta']);
  const owner = row('Owner');
  await expect(owner.locator('.ctx-rows[data-nested]')).toBeVisible();
  await expect(owner).toContainText('Team');
  await expect(owner).toContainText('Core');
  await expect(owner.locator('.ctx-row', { hasText: 'On call' })).toContainText('No');
  // Without a schema nothing says the string is a link, so it stays text.
  await expect(row('Ticket url')).toContainText('https://example.com/tickets/7');
  await expect(fields.getByRole('link')).toHaveCount(0);
});

test('context sources, build and test details are listed, and only https URLs are links', async ({ page }) => {
  await openReplay(page, `${server().origin}/r/demo-shop`);
  await page.getByTestId('context-tab').click();
  const panel = page.getByTestId('context-panel');
  const sources = panel.getByRole('region', { name: 'Sources' });
  await expect(sources.getByRole('link')).toHaveCount(2);
  await expect(sources.getByRole('link', { name: /^Example ticket/ })).toHaveAttribute('href', 'https://example.com/tickets/DEMO-1');
  await expect(sources.getByRole('link', { name: /^Example ticket/ })).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(sources).toContainText('github');
  await expect(panel.getByRole('region', { name: 'Build' })).toContainText('0.1.0');
  await expect(panel.getByRole('region', { name: 'Test' })).toContainText('rejects an unknown coupon');
});
