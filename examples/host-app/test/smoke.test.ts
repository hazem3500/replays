import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { ReplayBundle } from '@hazem3500/replays';
import { startServer } from '@hazem3500/replays/server';
import type { ViewerPlugin, ViewerPluginApi } from '@hazem3500/replays/viewer';

// The config module's default export sees an explicit local profile; no IAP/GCS adapter is instantiated.
process.env.HOST_APP_PROFILE = 'local';
const { hostConfig } = await import('../replays.config.ts');
const cwd = fileURLToPath(new URL('../', import.meta.url));

test('built host loads its theme, profiles, server hooks, browser contributions and read-only editing policy', async () => {
  const data = await mkdtemp(join(tmpdir(), 'replays-host-app-'));
  const env = {
    HOST_APP_PROFILE: 'local',
    DATA_DIR: data,
    DEV_USER: 'reviewer@example.com',
    POSTERS_DISABLED: '1',
    RENDER_DISABLED: '1',
  };
  const server = await startServer({ cwd, env, sampleDir: data, port: 0, host: '127.0.0.1', log: () => {} });
  const url = (path: string) => `${server.origin}/replays${path}`;
  try {
    assert.equal(server.runtime.auth.name, 'none');
    const configResponse = await fetch(url('/api/config'));
    assert.equal(configResponse.status, 200);
    const config = await configResponse.json();
    assert.equal(config.name, 'Example Replays');
    assert.equal(server.runtime.settings.branding.theme?.dark?.page, '#19131f');
    assert.deepEqual(
      config.profiles.map((profile: { id: string; retentionDays: number }) => [profile.id, profile.retentionDays]),
      [
        ['triage', 90],
        ['design-review', 90],
        ['walkthrough', 0],
      ],
    );
    assert.ok(config.plugins.includes('company-host'));
    assert.ok(!config.plugins.includes('iap'));
    assert.ok(!config.plugins.includes('gcs'));
    assert.equal(config.beta.editor, true);
    assert.equal(config.editing.enabled, false);
    assert.equal(server.runtime.settings.malleable.capabilities['comments:write'], 'deny');
    assert.equal(server.runtime.settings.malleable.capabilities['export:download'], 'deny');

    const me = await (await fetch(url('/api/me'))).json();
    assert.equal(me.email, 'reviewer@example.com');
    assert.equal(me.name, 'reviewer');
    assert.ok(me.people.roles.includes('reviewer'));
    const page = await (await fetch(url('/'), { headers: { accept: 'text/html' } })).text();
    assert.match(page, /Example Replays/);
    assert.match(page, /--page:#19131f/);
    assert.match(page, /name="theme-color"/);
    assert.match(page, /company-host/);

    const now = new Date().toISOString();
    const bundle: ReplayBundle = {
      meta: {
        id: 'host-smoke',
        title: 'Customer handoff',
        version: 1,
        url: 'https://app.example.com/project?invite_token=never-store',
        capturedAt: now,
        duration: 1000,
        viewport: { width: 800, height: 600 },
        eventCount: 3,
        profile: 'triage',
        people: [{ role: 'reviewer', email: 'reviewer@example.com', handles: { staff: 'reviewer' } }],
      },
      events: [
        { type: 4, timestamp: Date.parse(now), data: { href: 'https://app.example.com', width: 800, height: 600 } },
        {
          type: 2,
          timestamp: Date.parse(now) + 1,
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
                    {
                      type: 2,
                      id: 3,
                      tagName: 'body',
                      attributes: {},
                      childNodes: [
                        {
                          type: 2,
                          id: 4,
                          tagName: 'input',
                          attributes: { value: 'never-show-typed' },
                          childNodes: [],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            initialOffset: { left: 0, top: 0 },
          },
        },
        { type: 3, timestamp: Date.parse(now) + 500, data: { source: 5, id: 4, text: 'never-show-typed', isChecked: false } },
      ],
      console: [],
      network: [],
      steps: [],
      context: {
        version: 1,
        capturedAt: now,
        sources: [{ provider: 'company-support', ref: 'SUP-42', url: 'https://support.example.com/tickets/SUP-42' }],
        fields: { environment: 'staging', customerSession: true, uploadedBy: 'spoofed', flags: [{ key: 'new-timer', state: 'unknown' }] },
      },
    };
    const beforeUpload = Date.now();
    const upload = await fetch(url('/api/replays'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bundle),
    });
    assert.equal(upload.status, 201, await upload.text());
    const stored = await (await fetch(url('/api/replays/host-smoke'))).json();
    assert.equal(stored.context.fields.uploadedBy, 'reviewer@example.com');
    assert.ok(!stored.meta.url.includes('never-store'));
    assert.ok(!JSON.stringify(stored.events).includes('never-show-typed'));
    assert.equal((await fetch(url('/api/replays/host-smoke/edits'))).status, 200);
    assert.equal((await fetch(url('/api/replays/host-smoke/edits'), { method: 'HEAD' })).status, 200);
    const editWrite = await fetch(url('/api/replays/host-smoke/edits'), { method: 'PUT', body: 'invalid JSON' });
    assert.equal(editWrite.status, 403);
    assert.deepEqual(await editWrite.json(), { error: 'editing is turned off' });
    const summaries = await (await fetch(url('/api/replays?for=me&x-customer-session=1'))).json();
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].profile, 'triage');
    assert.equal(summaries[0].ext['company-host'].environment, 'staging');
    assert.equal(summaries[0].people[0].profileUrl, 'https://people.example.com/people/reviewer');
    const expires = Date.parse(summaries[0].expiresAt);
    assert.ok(expires >= beforeUpload + 90 * 24 * 60 * 60 * 1000);
    assert.ok(expires <= Date.now() + 90 * 24 * 60 * 60 * 1000);
    assert.equal((await fetch(url('/api/replays?x-customer-session=0')).then((response) => response.json())).length, 0);
    const refused = await fetch(url('/api/replays'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...bundle,
        meta: { ...bundle.meta, id: 'bad-person', people: [{ role: 'reviewer', email: 'outside@customer.example.com' }] },
      }),
    });
    assert.equal(refused.status, 400);

    // Fetch and execute the actual built, served ES module (no source import, browser or cloud credentials).
    const scriptResponse = await fetch(url('/_plugins/company-host/main.js'));
    assert.equal(scriptResponse.status, 200);
    const script = await scriptResponse.text();
    assert.equal(script, await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'));
    const browser = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)) as { default: ViewerPlugin };
    const registered: Record<string, unknown[]> = {};
    const registry = new Proxy(
      { pluginName: 'company-host' },
      {
        get(target, key) {
          if (key === 'pluginName') return target.pluginName;
          return (definition: unknown) => (registered[String(key)] ??= []).push(definition);
        },
      },
    ) as ViewerPluginApi;
    await browser.default(registry);
    assert.deepEqual(
      registered.registerIndexSection?.map((value) => (value as { id: string }).id),
      ['for-you'],
    );
    assert.deepEqual(
      registered.registerInspectorTab?.map((value) => (value as { id: string }).id),
      ['handoff'],
    );
    assert.equal(registered.registerIndexFilter?.length, 1);
    assert.equal(registered.registerContextSection?.length, 1);
    const column = registered.registerIndexColumn?.[0] as {
      render: (container: { textContent: string }, context: { summary: unknown }) => void;
    };
    const container = { textContent: '' };
    column.render(container, { summary: summaries[0] });
    assert.equal(container.textContent, 'staging');
    const style = await fetch(url('/_plugins/company-host/main.css'));
    assert.equal(style.status, 200);
    assert.match(await style.text(), /var\(--accent\)/);
    const crossSite = await fetch(url('/api/replays'), {
      method: 'POST',
      headers: { origin: 'https://app.example.com', 'sec-fetch-site': 'cross-site' },
      body: '{}',
    });
    assert.equal(crossSite.status, 403);
    assert.equal(crossSite.headers.get('access-control-allow-origin'), null);
  } finally {
    await server.close();
    await rm(data, { recursive: true, force: true });
  }
});

test('optional staff CORS is exact, preserves gzip preflights and leaves listing private', async () => {
  const data = await mkdtemp(join(tmpdir(), 'replays-host-cors-'));
  const env = {
    HOST_APP_PROFILE: 'local',
    HOST_APP_STAFF_UPLOAD_ORIGINS: 'https://app.example.com',
    DATA_DIR: data,
    DEV_USER: 'reviewer@example.com',
    POSTERS_DISABLED: '1',
    RENDER_DISABLED: '1',
  };
  const file = hostConfig(env);
  const plugins =
    file.plugins?.map((plugin) => {
      assert.ok(typeof plugin === 'object' && 'setup' in plugin);
      return plugin;
    }) ?? [];
  const server = await startServer({
    cwd,
    env,
    config: { dir: cwd, file, plugins },
    sampleDir: data,
    port: 0,
    host: '127.0.0.1',
    log: () => {},
  });
  const url = `${server.origin}/replays/api/replays`;
  try {
    const headers = {
      origin: 'https://app.example.com',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,content-encoding',
    };
    const preflight = await fetch(url, { method: 'OPTIONS', headers });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://app.example.com');
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
    assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /content-encoding/);
    const wrongOrigin = await fetch(url, { method: 'OPTIONS', headers: { ...headers, origin: 'https://other.example.com' } });
    assert.equal(wrongOrigin.headers.get('access-control-allow-origin'), null);
    assert.ok(wrongOrigin.status >= 400);
    const listing = await fetch(url, { headers: { origin: 'https://app.example.com' } });
    assert.equal(listing.headers.get('access-control-allow-origin'), null);
    const invalid = await fetch(url, {
      method: 'POST',
      headers: { origin: 'https://app.example.com', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get('access-control-allow-origin'), 'https://app.example.com');
    const unrelated = await fetch(`${url}/import`, { method: 'OPTIONS', headers });
    assert.equal(unrelated.headers.get('access-control-allow-origin'), null);
  } finally {
    await server.close();
    await rm(data, { recursive: true, force: true });
  }
});

test('deployed config selects real adapters, sign-in and pacing', () => {
  const deployed = hostConfig({});
  assert.equal(deployed.auth, 'iap');
  assert.equal(deployed.storage, 'gcs');
  assert.deepEqual(
    deployed.plugins?.map((plugin) => (typeof plugin === 'object' && 'name' in plugin ? plugin.name : plugin)),
    ['iap', 'gcs', 'company-host'],
  );
  assert.equal(deployed.trustForwardedHost, false);
  assert.deepEqual(deployed.signIn, { path: '/api/sign-in' });
  assert.deepEqual(deployed.capture, { stepPauseMs: 1200 });
  assert.throws(() => hostConfig({ HOST_APP_PROFILE: 'typo' }), /local or deployed/);
});
