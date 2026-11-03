import { expect, test } from '@playwright/test';
import type { ReplayBundle } from '@hazem3500/replays/model';

function recording(id: string, text: string): ReplayBundle {
  return {
    meta: {
      id,
      title: text,
      url: 'https://example.com/',
      capturedAt: '2026-11-02T00:00:00.000Z',
      duration: 1000,
      viewport: { width: 800, height: 600 },
      eventCount: 2,
      version: 1,
    },
    events: [
      { type: 4, timestamp: 1000, data: { href: 'https://example.com/', width: 800, height: 600 } },
      {
        type: 2,
        timestamp: 2000,
        data: {
          node: {
            type: 0,
            id: 1,
            childNodes: [
              {
                type: 2,
                id: 2,
                tagName: 'html',
                attributes: {},
                childNodes: [
                  { type: 2, id: 3, tagName: 'head', attributes: {}, childNodes: [] },
                  { type: 2, id: 4, tagName: 'body', attributes: {}, childNodes: [{ type: 3, id: 5, textContent: text }] },
                ],
              },
            ],
          },
          initialOffset: { top: 0, left: 0 },
        },
      },
    ],
    steps: [{ at: 0, kind: 'open', label: text }],
    console: [],
    network: [],
  };
}

test('the published service mounts real recordings and keeps cleanup ownership across replacement', async ({ page }) => {
  await page.goto('/headless.html');
  const result = await page.evaluate(
    async ({ firstBundle, nextBundle }) => {
      const { createReplayPlayback } = await import('../src/headless.ts');
      const first = document.createElement('div');
      const second = document.createElement('div');
      document.body.append(first, second);
      const playback = createReplayPlayback(firstBundle);
      try {
        const staleCleanup = playback.mount(first);
        const cleanup = playback.mount(second);
        staleCleanup();
        const firstCleared = first.childElementCount === 0;
        const mountedText = second.querySelector('iframe')?.contentDocument?.body.textContent;
        playback.load(nextBundle);
        const replacedText = second.querySelector('iframe')?.contentDocument?.body.textContent;
        playback.actions.seek(600);
        const time = playback.getSnapshot().time;
        cleanup();
        const cleaned = second.childElementCount === 0 && !second.hasAttribute('data-replays-playback');
        playback.mount(second);
        playback.destroy();
        const destroyed = second.childElementCount === 0 && playback.getSnapshot().phase === 'destroyed';
        return { firstCleared, mountedText, replacedText, time, cleaned, destroyed };
      } finally {
        playback.destroy();
        first.remove();
        second.remove();
      }
    },
    { firstBundle: recording('browser-one', 'First recording'), nextBundle: recording('browser-two', 'Replacement recording') },
  );
  expect(result).toMatchObject({ firstCleared: true, time: 600, cleaned: true, destroyed: true });
  expect(result.mountedText).toContain('First recording');
  expect(result.replacedText).toContain('Replacement recording');
});

test('the framework independent example replaces its recording from a file without the application shell', async ({ page }) => {
  await page.goto('/headless.html');
  const upload = async (bundle: ReplayBundle) =>
    page.locator('#recording').setInputFiles({
      name: `${bundle.meta.id}.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(bundle)),
    });
  await upload(recording('file-one', 'First local recording'));
  await expect(page.frameLocator('#stage iframe').locator('body')).toContainText('First local recording');
  await page.locator('#seek').evaluate((input: HTMLInputElement) => {
    input.stepUp(400);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#time')).toHaveText('0:00.4 / 0:01.0');
  await upload(recording('file-two', 'Second local recording'));
  await expect(page.frameLocator('#stage iframe').locator('body')).toContainText('Second local recording');
  await expect(page.locator('#time')).toHaveText('0:00.0 / 0:01.0');
  await expect(page.getByLabel('Recording diagnostics')).toHaveText('0 requests, 0 performance moments, 0 errors');
  await expect(page.locator('#error')).toHaveText('');
  await expect(page.locator('.app-shell')).toHaveCount(0);
});

test('the framework independent host derives diagnostics without React and resets them on replacement', async ({ page }) => {
  await page.goto('/headless.html');
  const first = recording('diagnostic-file', 'Failed payment');
  first.console = [{ at: 500, level: 'error', message: 'Payment failed' }];
  for (const bundle of [first, recording('clean-file', 'Clean recording')]) {
    await page.locator('#recording').setInputFiles({
      name: `${bundle.meta.id}.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(bundle)),
    });
    await expect(page.getByLabel('Recording diagnostics')).toHaveText(`0 requests, 0 performance moments, ${bundle.console.length} errors`);
  }
});
