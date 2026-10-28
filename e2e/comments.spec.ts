import { resolve } from 'node:path';

import { expect, type APIRequestContext, type Browser, type Page, test } from '@playwright/test';

import { openReplay, serveApp, uniqueId } from './support.ts';

// Comments (on by default): pinned to a moment or to the whole replay, shown as markers on the seek bar and in the
// Comments tab, with threads, resolve, author-only edit and delete, permalinks and the `M` shortcut.

const server = serveApp({
  AUTH_MODE: 'plugin',
  AUTH_PLUGIN: resolve(import.meta.dirname, 'comments-auth.mjs'),
  REPLAYS_BETA_EDITOR: 'true',
});
const base = () => server().origin;

const ADA = { 'x-e2e-user': 'ada@example.com', 'x-e2e-name': 'Ada Lovelace' };
const BOB = { 'x-e2e-user': 'bob@example.com', 'x-e2e-name': 'Bob Stone' };
const CY = { 'x-e2e-user': 'cy@example.com', 'x-e2e-name': 'Cy Young' };

/** A copy of the sample under its own id, so each test owns its comments. */
async function newReplay(request: APIRequestContext, origin = base()) {
  const id = uniqueId('comments');
  const bundle = await (await request.get(`${origin}/api/replays/demo-shop`, { headers: ADA })).json();
  bundle.meta.id = id;
  bundle.meta.title = 'Comments check';
  const response = await request.post(`${origin}/api/replays`, { data: bundle, headers: ADA });
  expect(response.status(), await response.text()).toBe(201);
  return id;
}

/** A comment through the API, as `who`; at is SOURCE ms. */
async function comment(
  request: APIRequestContext,
  id: string,
  body: Record<string, unknown>,
  who: Record<string, string> = ADA,
  origin = base(),
) {
  const response = await request.post(`${origin}/api/replays/${id}/comments`, { data: body, headers: who });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as { id: string; at?: number };
}

async function as(browser: Browser, who: Record<string, string>, viewport?: { width: number; height: number }) {
  const context = await browser.newContext({ extraHTTPHeaders: who, ...(viewport ? { viewport } : {}) });
  return { context, page: await context.newPage() };
}

const markers = (page: Page) => page.getByTestId('comment-marker');
const threads = (page: Page) => page.getByTestId('comment-thread');

test('M starts a comment at the playhead: the panel opens, the box is focused and pinned, Ctrl+Enter posts it', async ({
  browser,
  request,
}) => {
  const id = await newReplay(request);
  const { context, page } = await as(browser, ADA);
  await openReplay(page, `${base()}/r/${id}?t=3`);
  await expect(page.getByTestId('playhead')).toHaveText('0:03.0');
  await expect(page.getByTestId('comments-panel')).toHaveCount(0);

  await page.keyboard.press('m');
  await expect(page.getByTestId('comments-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('comment-input')).toBeFocused();
  await expect(page.getByTestId('comment-pin')).toHaveText('0:03.0');
  // Typing does not trigger shortcuts (m, c, n, k ...).
  await page.keyboard.type('The cart total looks off');
  await expect(page.getByTestId('comment-input')).toHaveValue('The cart total looks off');
  await page.keyboard.press('Control+Enter');

  await expect(threads(page)).toHaveCount(1);
  await expect(page.getByTestId('comment-body')).toHaveText('The cart total looks off');
  await expect(page.getByTestId('comment-author')).toHaveText('Ada Lovelace');
  await expect(page.getByTestId('comment-time')).toHaveText('0:03.0');
  await expect(threads(page)).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('comments-tab')).toContainText('1');
  // Stored on the source timeline.
  const stored = await (await request.get(`${base()}/api/replays/${id}/comments`, { headers: ADA })).json();
  expect(stored.comments[0]).toMatchObject({ at: 3000, body: 'The cart total looks off', mine: true });
  await context.close();
});

test('a pinned comment is a marker on the seek bar: hover previews it, click seeks and selects it', async ({ browser, request }) => {
  const id = await newReplay(request);
  await comment(request, id, { body: 'Coupon error is unclear', at: 6000 });
  await comment(request, id, { body: 'Whole-replay note' });
  const { context, page } = await as(browser, BOB);
  await openReplay(page, `${base()}/r/${id}`);

  await expect(markers(page)).toHaveCount(1);
  const marker = markers(page);
  // Placed at 6.0 s of 8.8 s along the track.
  const seek = (await page.getByRole('slider', { name: 'Seek' }).boundingBox())!;
  const dot = (await marker.boundingBox())!;
  const fraction = (dot.x + dot.width / 2 - seek.x) / seek.width;
  expect(fraction).toBeGreaterThan(0.62);
  expect(fraction).toBeLessThan(0.75);
  await expect(marker).toHaveAccessibleName(/Ada Lovelace commented: Coupon error is unclear, at 0:06\.0/);

  const card = page.getByTestId('comment-card');
  await expect(card).toBeHidden();
  await marker.hover();
  await expect(card).toBeVisible();
  await expect(card).toContainText('Ada Lovelace');
  await expect(card).toContainText('Coupon error is unclear');
  await expect(card).toContainText('0:06.0');

  await marker.click();
  await expect(page.getByTestId('playhead')).toHaveText('0:06.0');
  await page.getByTestId('comments-tab').click();
  await expect(page.locator('[data-testid="comment-thread"][data-selected]')).toContainText('Coupon error is unclear');
  // The whole-replay comment has no marker.
  await expect(markers(page)).toHaveCount(1);
  await expect(threads(page)).toHaveCount(2);
  await context.close();
});

test('the panel lists comments in time order and highlights the one at (or just ahead of) the playhead', async ({ browser, request }) => {
  const id = await newReplay(request);
  await comment(request, id, { body: 'third', at: 7000 });
  await comment(request, id, { body: 'first', at: 1000 });
  await comment(request, id, { body: 'second', at: 4000 });
  await comment(request, id, { body: 'about everything' });
  const { context, page } = await as(browser, ADA);
  await openReplay(page, `${base()}/r/${id}?t=0.2`);
  await page.getByTestId('comments-tab').click();

  await expect(page.getByTestId('comment-body')).toHaveText(['about everything', 'first', 'second', 'third']);
  const active = page.locator('[data-testid="comment-thread"][data-active]');
  // Before the first comment: the one ahead is nearest.
  await expect(active).toContainText('first');
  const playhead = async (seconds: number) => {
    await page.evaluate((value) => {
      const url = new URL(location.href);
      url.searchParams.set('t', String(value));
      location.replace(url);
    }, seconds);
  };
  await playhead(4.2);
  await expect(page.getByTestId('playhead')).toHaveText('0:04.2');
  await page.getByTestId('comments-tab').click();
  await expect(active).toContainText('second');
  await expect(active).toHaveCount(1);
  // Clicking a thread's time seeks there.
  await threads(page).filter({ hasText: 'third' }).getByTestId('comment-time').click();
  await expect(page.getByTestId('playhead')).toHaveText('0:07.0');
  await expect(active).toContainText('third');
  await context.close();
});

test('threads: replies, resolve and reopen, edit and delete by the author only', async ({ browser, request }) => {
  const id = await newReplay(request);
  const root = await comment(request, id, { body: 'Is this slow?', at: 2000 });
  const ada = await as(browser, ADA);
  const bob = await as(browser, BOB);
  await openReplay(ada.page, `${base()}/r/${id}`);
  await openReplay(bob.page, `${base()}/r/${id}`);
  await ada.page.getByTestId('comments-tab').click();
  await bob.page.getByTestId('comments-tab').click();

  // Bob replies; the reply is his, under Ada's thread.
  await bob.page.getByTestId('comment-reply').click();
  await bob.page.getByTestId('comment-reply-input').fill('Yes, 2 s on my machine');
  await bob.page.getByTestId('comment-reply-send').click();
  await expect(bob.page.getByTestId('comment-reply-item')).toHaveCount(1);
  await expect(bob.page.getByTestId('comment-reply-item')).toContainText('Bob Stone');

  // Only the author sees edit and delete: Bob has them on his reply, not on Ada's comment.
  const adaRoot = bob.page.getByTestId('comment').filter({ hasText: 'Is this slow?' });
  await expect(adaRoot.getByTestId('comment-edit')).toHaveCount(0);
  await expect(adaRoot.getByTestId('comment-delete')).toHaveCount(0);
  const bobReply = bob.page.getByTestId('comment-reply-item').getByTestId('comment');
  await expect(bobReply.getByTestId('comment-edit')).toBeVisible();
  // The server agrees, whatever the UI shows.
  const forbidden = await request.patch(`${base()}/api/replays/${id}/comments/${root.id}`, { data: { body: 'hijack' }, headers: BOB });
  expect(forbidden.status()).toBe(403);
  expect((await request.delete(`${base()}/api/replays/${id}/comments/${root.id}`, { headers: BOB })).status()).toBe(403);

  // Resolve (anyone), reopen.
  await bob.page.getByTestId('comment-resolve').first().click();
  await expect(bob.page.getByTestId('comment-resolved-note')).toContainText('Resolved by Bob Stone');
  await expect(bob.page.getByTestId('comment-thread')).toHaveAttribute('data-resolved', 'true');
  await bob.page.getByTestId('comment-resolve').first().click();
  await expect(bob.page.getByTestId('comment-resolved-note')).toHaveCount(0);

  // Ada edits her comment: it says edited.
  await ada.page.getByTestId('comment-edit').first().click();
  await ada.page.getByTestId('comment-edit-input').fill('Is this slow? (edited)');
  await ada.page.getByTestId('comment-edit-save').click();
  await expect(ada.page.getByTestId('comment-body').first()).toHaveText('Is this slow? (edited)');
  await expect(ada.page.getByTestId('comment').first()).toContainText('edited');

  // Ada deletes the thread (after confirming): the reply goes with it, the marker too.
  await expect(markers(ada.page)).toHaveCount(1);
  await ada.page.getByTestId('comment-delete').first().click();
  await ada.page.getByTestId('comment-delete-confirm').click();
  await expect(threads(ada.page)).toHaveCount(0);
  await expect(markers(ada.page)).toHaveCount(0);
  await ada.context.close();
  await bob.context.close();
});

test('reactions at a moment show as emoji markers and quiet chips their author can remove', async ({ browser, request }) => {
  const id = await newReplay(request);
  const { context, page } = await as(browser, ADA);
  await openReplay(page, `${base()}/r/${id}?t=2`);
  await page.getByTestId('comments-tab').click();
  await page.getByTestId('comment-react').click();
  await page.getByRole('button', { name: 'React 🎉' }).click();
  await expect(page.getByRole('button', { name: 'React 🎉' })).toHaveCount(0);
  await expect(markers(page)).toHaveCount(1);
  await expect(markers(page)).toHaveAccessibleName(/reacted 🎉, at 0:02\.0/);
  await expect(page.getByTestId('comment-reaction')).toHaveText('🎉');
  await expect(threads(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove your 🎉 reaction' }).click();
  await expect(markers(page)).toHaveCount(0);
  await expect(page.getByTestId('comments-empty')).toBeVisible();
  await context.close();
});

test('the composer pins the playhead or the whole replay, and Open and Resolved filter the threads', async ({ browser, request }) => {
  const id = await newReplay(request);
  const done = await comment(request, id, { body: 'Already fixed', at: 1000 }, CY);
  await comment(request, id, { body: 'Still open', at: 4000 }, CY);
  await request.patch(`${base()}/api/replays/${id}/comments/${done.id}`, { data: { resolved: true }, headers: BOB });
  const { context, page } = await as(browser, CY);
  await openReplay(page, `${base()}/r/${id}?t=2`);
  await page.getByTestId('comments-tab').click();

  await page.getByTestId('comments-filter-open').click();
  await expect(page.getByTestId('comment-body')).toHaveText(['Still open']);
  await page.getByTestId('comments-filter-resolved').click();
  await expect(page.getByTestId('comment-body')).toHaveText(['Already fixed']);
  await page.getByTestId('comment-resolve').click();
  await expect(page.getByTestId('comments-filter')).toHaveCount(0);
  await expect(page.getByTestId('comment-body')).toHaveText(['Already fixed', 'Still open']);

  await expect(page.getByTestId('comment-pin')).toHaveText('0:02.0');
  await page.getByTestId('comment-pin').click();
  await expect(page.getByTestId('comment-pin')).toHaveText('Whole replay');
  await page.getByTestId('comment-input').fill('About the whole flow');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('comment-body').first()).toHaveText('About the whole flow');
  const stored = (await (await request.get(`${base()}/api/replays/${id}/comments`, { headers: CY })).json()).comments as Array<{
    body: string;
    at?: number;
  }>;
  expect(stored.find((entry) => entry.body === 'About the whole flow')?.at).toBeUndefined();
  await context.close();
});

test('a comment permalink opens the panel on that comment and seeks to it', async ({ browser, request }) => {
  const id = await newReplay(request);
  await comment(request, id, { body: 'other', at: 1000 });
  const target = await comment(request, id, { body: 'Look at this one', at: 5000 });
  const { context, page } = await as(browser, BOB);
  // The time in the link is only a fallback: the comment itself decides.
  await page.goto(`${base()}/r/${id}?t=0.5#comment-${target.id}`);
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  await expect(page.getByTestId('comments-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-testid="comment-thread"][data-selected]')).toContainText('Look at this one');
  await expect(page.getByTestId('playhead')).toHaveText('0:05.0');

  // "Copy link" builds the same kind of link, and keeps the address bar on it.
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base() }).catch(() => undefined);
  await page.locator('[data-testid="comment-thread"][data-selected]').getByTestId('comment-copy-link').click();
  await expect(page).toHaveURL(new RegExp(`\\?t=5\\.0#comment-${target.id}$`));

  // A link to a comment that is gone says so instead of failing quietly.
  const gone = await as(browser, BOB);
  await gone.page.goto(`${base()}/r/${id}#comment-c-0000000000`);
  await expect(gone.page.getByText('That comment no longer exists')).toBeVisible();
  await gone.context.close();
  await context.close();
});

test('with edits applied, markers follow the edited timeline and cut-out comments are listed as removed', async ({ browser, request }) => {
  const id = await newReplay(request);
  await comment(request, id, { body: 'before the cut', at: 2000 });
  await comment(request, id, { body: 'inside the cut', at: 4000 });
  await comment(request, id, { body: 'after the cut', at: 6000 });
  const saved = await request.put(`${base()}/api/replays/${id}/edits`, {
    headers: { ...ADA, 'if-match': '"e.none"' },
    data: { version: 1, cuts: [{ id: 'cut-1', from: 3500, to: 4500 }] },
  });
  expect(saved.status(), await saved.text()).toBe(200);

  const { context, page } = await as(browser, ADA);
  await openReplay(page, `${base()}/r/${id}`);
  await page.getByTestId('comments-tab').click();
  // The cut's comment stays listed, marked, with no marker and no seeking; the others keep their order.
  await expect(markers(page)).toHaveCount(2);
  await expect(page.getByTestId('comment-body')).toHaveText(['before the cut', 'inside the cut', 'after the cut']);
  const removed = threads(page).filter({ hasText: 'inside the cut' });
  await expect(removed).toHaveAttribute('data-removed', 'true');
  await expect(removed.getByTestId('comment-removed')).toContainText('In removed section');
  await expect(removed.getByTestId('comment-time')).toHaveCount(0);
  // After the cut, 6.0 s of the source is 5.0 s of what is on screen.
  await threads(page).filter({ hasText: 'after the cut' }).getByTestId('comment-time').click();
  await expect(page.getByTestId('playhead')).toHaveText('0:05.0');

  // A comment made now is stored on the source timeline: 5.0 s edited is 6.0 s of the recording.
  await page.keyboard.press('m');
  await expect(page.getByTestId('comment-input')).toBeFocused();
  await expect(page.getByTestId('comment-pin')).toHaveText('0:05.0');
  await page.keyboard.type('Made on the edited timeline');
  await page.keyboard.press('Control+Enter');
  await expect(threads(page)).toHaveCount(4);
  const stored = (await (await request.get(`${base()}/api/replays/${id}/comments`, { headers: ADA })).json()).comments as Array<{
    body: string;
    at: number;
  }>;
  expect(stored.find((entry) => entry.body === 'Made on the edited timeline')!.at).toBe(6000);

  // The original recording shows every comment where it was made, the cut one included. The last two share a
  // moment (6.0 s), so they merge into one marker with a count.
  const original = await as(browser, ADA);
  await openReplay(original.page, `${base()}/r/${id}?original=1`);
  await expect(markers(original.page)).toHaveCount(3);
  await expect(original.page.locator('.comment-marker-count')).toHaveText('2');
  await original.context.close();
  await context.close();
});

test('the shortcut sheet lists M, and the Comments tab is last with its count', async ({ browser, request }) => {
  const id = await newReplay(request);
  await comment(request, id, { body: 'one', at: 100 });
  const { context, page } = await as(browser, ADA);
  await openReplay(page, `${base()}/r/${id}`);
  await page.keyboard.press('Shift+?');
  const sheet = page.getByTestId('shortcut-sheet');
  await expect(sheet).toContainText('Comment at the current time');
  await expect(sheet.locator('dt:has-text("Comment at the current time") + dd [data-slot="kbd"]')).toHaveText('M');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab').last()).toHaveText(/Comments/);
  await context.close();
});

test('on a phone: the Comments tab, a pinned comment and a thread fit the 390 px screen', async ({ browser, request }) => {
  const id = await newReplay(request);
  const root = await comment(request, id, { body: 'Does this need a retry?', at: 3000 });
  await comment(request, id, { body: 'Yes, flaky on slow networks', parentId: root.id } as never, BOB);
  const { context, page } = await as(browser, ADA, { width: 390, height: 844 });
  await openReplay(page, `${base()}/r/${id}`);
  await page.getByTestId('comments-tab').click();
  await expect(threads(page)).toHaveCount(1);
  await expect(page.getByTestId('comment-reply-item')).toContainText('Yes, flaky on slow networks');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  await expect(markers(page)).toHaveCount(1);
  const box = (await markers(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.getByTestId('comment-input').fill('From my phone');
  await page.getByTestId('comment-submit').click();
  await expect(threads(page)).toHaveCount(2);
  await context.close();
});

// ---- Other deployments ----

test.describe('without sign-in (auth=none)', () => {
  // Its own server: the shared one keeps just the two samples.
  const anonymous = serveApp();

  test('comments are labelled Anonymous, with a quiet note while composing', async ({ page }) => {
    const origin = anonymous().origin;
    const id = uniqueId('anon');
    const bundle = await (await page.request.get(`${origin}/api/replays/demo-shop`)).json();
    bundle.meta.id = id;
    expect((await page.request.post(`${origin}/api/replays`, { data: bundle })).status()).toBe(201);
    await openReplay(page, `${origin}/r/${id}`);
    await page.getByTestId('comments-tab').click();
    await expect(page.getByTestId('comments-anonymous-notice')).toBeHidden();
    await page.getByTestId('comment-input').fill('Posted without signing in');
    await expect(page.getByTestId('comments-anonymous-notice')).toBeVisible();
    await expect(page.getByTestId('comments-anonymous-notice')).toContainText('Anonymous');
    await page.getByTestId('comment-submit').click();
    await expect(page.getByTestId('comment-author')).toHaveText('Anonymous');
    await expect(page.getByTestId('comment-body')).toHaveText('Posted without signing in');
  });
});

test.describe('comments switched off (REPLAYS_COMMENTS=false)', () => {
  const off = serveApp({ REPLAYS_COMMENTS: 'false' });

  test('no tab, no markers, no shortcut, no requests, and a 404 API', async ({ page, request }) => {
    const origin = off().origin;
    const requests: string[] = [];
    page.on('request', (entry) => requests.push(new URL(entry.url()).pathname));
    await openReplay(page, `${origin}/r/demo-shop?t=2`);
    await expect(page.getByTestId('comments-tab')).toHaveCount(0);
    await expect(markers(page)).toHaveCount(0);
    await page.keyboard.press('m');
    await expect(page.getByTestId('comments-panel')).toHaveCount(0);
    await page.keyboard.press('Shift+?');
    await expect(page.getByTestId('shortcut-sheet')).not.toContainText('Comment at the current time');
    await page.keyboard.press('Escape');
    await expect(page.locator('meta[name="app-comments"]')).toHaveAttribute('content', '');
    expect(requests.filter((path) => /\/comments(\/|$)/.test(path))).toEqual([]);

    const get = await request.get(`${origin}/api/replays/demo-shop/comments`);
    expect(get.status()).toBe(404);
    expect(await get.json()).toEqual({ error: 'not found' });
    expect((await request.post(`${origin}/api/replays/demo-shop/comments`, { data: { body: 'x' } })).status()).toBe(404);
    expect((await (await request.get(`${origin}/api/config`)).json()).comments).toBe(false);
  });
});
