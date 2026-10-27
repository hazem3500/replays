import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { startServer, type RunningServer } from '@hazem3500/replays/server';
import { freePort } from '../../../scripts/test-server.mjs';

let server: RunningServer;
let data: string;
let storyOrigin: string;
let stories: ReturnType<typeof spawn>;
test.beforeAll(async () => {
  data = await mkdtemp(join(tmpdir(), 'replays-agent-native-'));
  server = await startServer({
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    port: 0,
    host: '127.0.0.1',
    log: () => {},
    sampleDir: fileURLToPath(new URL('../../../sample', import.meta.url)),
    env: { DATA_DIR: data, POSTERS_DISABLED: '1', RENDER_DISABLED: '1' },
  });
  const port = await freePort();
  storyOrigin = `http://127.0.0.1:${port}`;
  stories = spawn(
    process.execPath,
    [
      fileURLToPath(import.meta.resolve('vite-plus/bin')),
      'preview',
      '--outDir',
      'storybook-static',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      stdio: 'ignore',
    },
  );
  await expect
    .poll(async () =>
      fetch(storyOrigin)
        .then((r) => r.ok)
        .catch(() => false),
    )
    .toBe(true);
});
test.afterAll(async () => {
  if (stories && stories.exitCode === null) {
    const exited = new Promise((resolve) => stories.once('exit', resolve));
    stories.kill('SIGTERM');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
    if (stories.exitCode === null) stories.kill('SIGKILL');
  }
  await server?.close();
  if (data) await rm(data, { recursive: true, force: true });
});

async function runTool(page: Page, name: string, input = {}) {
  await page.getByLabel('Replays tool', { exact: true }).selectOption(name);
  await page.getByLabel('Tool arguments (JSON object)').fill(JSON.stringify(input));
  await page.getByRole('button', { name: 'Run tool', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run tool', exact: true })).toBeEnabled();
  return page.locator('pre[aria-live="polite"]');
}

for (const mode of ['native', 'stand-in'] as const) {
  test(`real Agent-Native client uses ${mode} WebMCP; drafts cannot save themselves`, async ({ page, request, browser }) => {
    if (mode === 'stand-in')
      await page.addInitScript(() => {
        Object.defineProperty(document, 'modelContext', { value: undefined, configurable: true });
        Object.defineProperty(navigator, 'modelContext', { value: undefined, configurable: true });
      });
    await page.goto(`${server.origin}/r/demo-shop`);
    await page.getByRole('tab', { name: 'Agent-Native', exact: true }).click();
    await expect(page.locator('pre[aria-live="polite"]')).toContainText('tools discovered');
    const polyfill = await page.evaluate(
      () => (document as Document & { modelContext?: { polyfill?: boolean } }).modelContext?.polyfill === true,
    );
    expect(polyfill, `native feature must really be available (${browser.version()})`).toBe(mode === 'stand-in');
    if (mode === 'native') {
      expect(
        await page.evaluate(() => Object.prototype.toString.call((document as Document & { modelContext?: unknown }).modelContext)),
      ).toBe('[object ModelContext]');
    }
    console.log(`WebMCP ${mode}: Chromium ${browser.version()}`);
    const options = await page.getByLabel('Replays tool', { exact: true }).locator('option').allTextContents();
    expect(options).toEqual(expect.arrayContaining(['get_app_state', 'seek', 'install_plugin_draft', 'request_keep']));
    expect(options).not.toContain('save_plugin');
    expect(options).not.toContain('approve_plugin');
    await expect(await runTool(page, 'get_app_state')).toContainText('demo-shop');
    await expect(await runTool(page, 'seek', { ms: 1000 })).toContainText('1000');
    await expect(await runTool(page, 'seek', { ms: -1 })).toContainText('non-negative');
    const id = `framework-${mode}`;
    await expect(
      await runTool(page, 'install_plugin_draft', {
        manifest: {
          format: 'replays-user-plugin/1',
          id,
          name: 'Framework draft',
          permissions: [],
          contributes: { tabs: [{ id: 'main', label: 'Draft' }] },
        },
        source: "replays.tab('main', (el) => { el.textContent = 'Draft only'; });",
      }),
    ).toContainText('"installed":true');
    await runTool(page, 'request_keep', { id });
    await expect(page.getByTestId('keep-dialog')).toBeVisible();
    const saved = await (await request.get(`${server.origin}/api/malleable/plugins`)).json();
    expect(saved.plugins).toEqual([]);
    await page.getByTestId('keep-dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('keep-dialog')).not.toBeVisible();
  });
}

test('framework discovery recovers when the stand-in initializes after the tab opens', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'modelContext', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'modelContext', { value: undefined, configurable: true });
  });
  let release!: () => void;
  const configReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/config', async (route) => {
    await configReady;
    await route.continue();
  });
  try {
    await page.goto(`${server.origin}/r/demo-shop`);
    await page.getByRole('tab', { name: 'Agent-Native', exact: true }).click();
    await expect(page.locator('pre[aria-live="polite"]')).toContainText('Waiting for Replays WebMCP initialization');
    await expect(page.getByRole('button', { name: 'Run tool', exact: true })).toBeDisabled();
    release();
    await expect(page.locator('pre[aria-live="polite"]')).toContainText('tools discovered');
    await expect(await runTool(page, 'get_app_state')).toContainText('demo-shop');
  } finally {
    release();
  }
});

test('Storybook renders fixture states, themes and real permission decisions without service calls', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });
  const story = async (id: string, theme = 'dark') =>
    page.goto(`${storyOrigin}/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`);
  await story('viewer-states--loading');
  await expect(page.getByRole('status')).toHaveText('Loading replay…');
  await story('viewer-states--host-context', 'light');
  await expect(page.getByTestId('context-panel')).toContainText('Example host');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await story('viewer-states--empty-context');
  await expect(page.getByTestId('context-empty')).toContainText('No context was captured');
  await story('viewer-states--plugin-error');
  await expect(page.locator('[data-plugin-error]')).toHaveText('Company handoff could not be shown.');
  await story('plugins-permission--comment-approval');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Denied; no comment was written.');
  await story('plugins-permission--untrusted-preview');
  await expect(page.getByTestId('permission-preview')).toContainText('<script>recorded page text</script>');
  await page.getByRole('button', { name: 'Allow this once' }).click();
  await expect(page.getByRole('status')).toContainText('Allowed for this fixture; no comment was written.');
  // Storybook reuses the preview document on story selection, so session consent must not carry over to another fixture.
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  const selectStory = (storyId: string) =>
    page.evaluate((id) => {
      const channel = (window as Window & { __STORYBOOK_ADDONS_CHANNEL__?: { emit(event: string, input: unknown): void } })
        .__STORYBOOK_ADDONS_CHANNEL__;
      if (!channel) throw new Error('Storybook preview channel is unavailable');
      channel.emit('setCurrentStory', { storyId: id, viewMode: 'story' });
    }, storyId);
  await selectStory('plugins-permission--comment-approval');
  await expect(page.getByTestId('permission-preview')).toContainText('Expected: checkout succeeds');
  await page.getByRole('button', { name: 'Allow until I reload', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Allowed for this fixture');
  await selectStory('plugins-permission--untrusted-preview');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expect(page.getByTestId('permission-preview')).toContainText('<script>recorded page text</script>');
  await page.getByRole('button', { name: 'Deny', exact: true }).click();
  await selectStory('plugins-permission--comment-approval');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
  expect(apiRequests).toEqual([]);
});
