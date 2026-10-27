import { afterEach, describe, expect, it } from 'vitest';

import { McpServer } from '../src/mcp/server.ts';
import type { RunningServer } from '../src/server/start.ts';
import { approval as testApproval, asUser, boot, closeServers, who } from './malleable-server-fixture.ts';
import { diffLines } from '../src/shared/line-diff.ts';
import { BRIDGE_TOOLS } from '../src/shared/malleable-tools.ts';
import { parseManifest, parsePluginFile, pluginFile, PluginFormatError, starterPlugin } from '../src/shared/malleable.ts';
import { SANDBOX_CSP } from '../src/shared/sandbox-runtime.ts';

afterEach(closeServers);

const starter = () => starterPlugin('failed-by-endpoint');

async function approve(
  server: RunningServer,
  user: string,
  action: 'save' | 'delete',
  scope: string,
  id: string,
  content?: { manifest: unknown; source: string },
) {
  return testApproval(server, user, { action, scope, id, ...(content ? { content } : {}) });
}

async function save(
  server: RunningServer,
  user: string,
  scope: string,
  content: { manifest: ReturnType<typeof starter>['manifest']; source: string },
  baseVersion: number,
  message = '',
) {
  const approval = await approve(server, user, 'save', scope, content.manifest.id, content);
  return fetch(`${server.origin}/api/malleable/plugins/${scope}/${content.manifest.id}`, {
    method: 'PUT',
    headers: asUser(user),
    body: JSON.stringify({ ...content, baseVersion, message, approval }),
  });
}

describe('with beta.malleable off (the default)', () => {
  it('has no routes, no sandbox page, no bridge and says so', async () => {
    const server = await boot();
    for (const path of ['/api/malleable/plugins', '/_malleable/sandbox.html', '/api/malleable/bridge/tools'])
      expect((await fetch(`${server.origin}${path}`, { headers: asUser('ada') })).status).toBe(404);
    const call = await fetch(`${server.origin}/api/malleable/bridge/call`, { method: 'POST', headers: asUser('ada'), body: '{}' });
    expect(call.status).toBe(404);
    const config = await (await fetch(`${server.origin}/api/config`, { headers: asUser('ada') })).json();
    expect(config.beta).toEqual({ editor: false, malleable: false });
    expect(config.plugins).not.toContain('malleable');
    const home = await fetch(`${server.origin}/`, { headers: { ...asUser('ada'), accept: 'text/html' } });
    expect(home.headers.get('content-security-policy')).toBeNull();
    expect(await home.text()).not.toMatch(/content="[^"]*malleable/);
  });
});

describe('with beta.malleable on', () => {
  it('stores declared plugin settings per signed-in person with version checks', async () => {
    const server = await boot({ REPLAYS_BETA_MALLEABLE: 'true' });
    const content = starter();
    content.manifest.settings = [{ id: 'compact', label: 'Compact', type: 'boolean', default: false }];
    expect((await save(server, 'ada', 'user', content, 0)).status).toBe(200);
    const url = `${server.origin}/api/malleable/settings/user/${content.manifest.id}`;
    expect(await (await fetch(url, { headers: asUser('ada') })).json()).toEqual({ version: 0, values: { compact: false } });
    const update = (body: unknown) => fetch(url, { method: 'PUT', headers: asUser('ada'), body: JSON.stringify(body) });
    expect((await update({ id: 'compact', value: true, baseVersion: 0 })).status).toBe(200);
    expect((await update({ id: 'compact', value: false, baseVersion: 0 })).status).toBe(409);
    expect((await update({ id: 'compact', value: 'yes', baseVersion: 1 })).status).toBe(400);
    expect((await fetch(url, { headers: asUser('grace') })).status).toBe(404);
    expect(await (await fetch(url, { headers: asUser('ada') })).json()).toEqual({ version: 1, values: { compact: true } });
  });
});

describe('saved user plugins', () => {
  it('serves the sandbox page with a CSP that forbids every outgoing request, and tells the page', async () => {
    const server = await boot({ REPLAYS_BETA_MALLEABLE: 'true' });
    const page = await fetch(`${server.origin}/_malleable/sandbox.html`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toBe(SANDBOX_CSP);
    for (const directive of ["default-src 'none'", "connect-src 'none'", "img-src 'none'", "frame-src 'none'", "form-action 'none'"])
      expect(SANDBOX_CSP).toContain(directive);
    expect(SANDBOX_CSP).not.toContain('unsafe-eval');
    expect(await page.text()).toContain('window.replays');
    const config = await (await fetch(`${server.origin}/api/config`, { headers: asUser('ada') })).json();
    expect(config.beta.malleable).toBe(true);
    expect(config.plugins).toContain('malleable');
  });

  it('refuses to store a plugin without the person’s approval, and a token works once, for that content only', async () => {
    const server = await boot({ REPLAYS_BETA_MALLEABLE: 'true' });
    const content = starter();
    const url = `${server.origin}/api/malleable/plugins/user/failed-by-endpoint`;
    const bare = await fetch(url, { method: 'PUT', headers: asUser('ada'), body: JSON.stringify({ ...content, baseVersion: 0 }) });
    expect(bare.status).toBe(403);
    const forged = await fetch(url, {
      method: 'PUT',
      headers: asUser('ada'),
      body: JSON.stringify({ ...content, baseVersion: 0, approval: 'ap_forged' }),
    });
    expect(forged.status).toBe(403);
    expect((await (await fetch(`${server.origin}/api/malleable/plugins`, { headers: asUser('ada') })).json()).plugins).toEqual([]);

    // A token minted for one source cannot save another.
    const token = await approve(server, 'ada', 'save', 'user', content.manifest.id, content);
    const swapped = await fetch(url, {
      method: 'PUT',
      headers: asUser('ada'),
      body: JSON.stringify({ manifest: content.manifest, source: `${content.source}\n// changed`, baseVersion: 0, approval: token }),
    });
    expect(swapped.status).toBe(403);
    // …and it is spent by the attempt.
    const reuse = await fetch(url, {
      method: 'PUT',
      headers: asUser('ada'),
      body: JSON.stringify({ ...content, baseVersion: 0, approval: token }),
    });
    expect(reuse.status).toBe(403);
    // Someone else cannot use a token minted for ada.
    const adas = await approve(server, 'ada', 'save', 'user', content.manifest.id, content);
    const bob = await fetch(url, {
      method: 'PUT',
      headers: asUser('bob'),
      body: JSON.stringify({ ...content, baseVersion: 0, approval: adas }),
    });
    expect(bob.status).toBe(403);

    expect((await save(server, 'ada', 'user', content, 0, 'first')).status).toBe(200);
    // Deleting needs approval too.
    expect((await fetch(url, { method: 'DELETE', headers: asUser('ada') })).status).toBe(403);
    const del = await approve(server, 'ada', 'delete', 'user', 'failed-by-endpoint');
    expect((await fetch(`${url}?approval=${del}`, { method: 'DELETE', headers: asUser('ada') })).status).toBe(200);
    expect((await fetch(url, { headers: asUser('ada') })).status).toBe(404);
  });

  it('keeps every version, refuses a stale save and reverts by saving an old version again', async () => {
    const server = await boot({ REPLAYS_BETA_MALLEABLE: 'true' });
    const v1 = starter();
    const v2 = { manifest: v1.manifest, source: `${v1.source}// second\n` };
    expect((await save(server, 'ada', 'user', v1, 0, 'first')).status).toBe(200);
    expect((await save(server, 'ada', 'user', v2, 1, 'second')).status).toBe(200);
    const stale = await save(server, 'ada', 'user', v2, 1, 'from a stale tab');
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toMatch(/version 2/);
    // Revert: the old content, saved as a new version; nothing is rewritten.
    expect((await save(server, 'ada', 'user', v1, 2, 'Revert to v1')).status).toBe(200);
    const history = await (
      await fetch(`${server.origin}/api/malleable/plugins/user/failed-by-endpoint`, { headers: asUser('ada') })
    ).json();
    expect(history.format).toBe('replays-user-plugin-history/1');
    expect(history.versions.map((v: { n: number; message: string }) => [v.n, v.message])).toEqual([
      [1, 'first'],
      [2, 'second'],
      [3, 'Revert to v1'],
    ]);
    expect(history.versions[2].source).toBe(history.versions[0].source);
    expect(history.versions[2].sha256).toBe(history.versions[0].sha256);
    expect(history.versions[1].sha256).not.toBe(history.versions[0].sha256);
    const list = await (await fetch(`${server.origin}/api/malleable/plugins`, { headers: asUser('ada') })).json();
    expect(list.plugins).toMatchObject([{ id: 'failed-by-endpoint', scope: 'user', version: 3, by: 'ada' }]);
  });

  it('keeps user plugins private and shares workspace plugins', async () => {
    const server = await boot({ REPLAYS_BETA_MALLEABLE: 'true' }, [who], { malleable: { scopes: ['user', 'workspace'] } });
    const mine = starterPlugin('mine');
    const shared = starterPlugin('shared');
    expect((await save(server, 'ada', 'user', mine, 0)).status).toBe(200);
    expect((await save(server, 'ada', 'workspace', shared, 0)).status).toBe(200);
    const names = async (user: string) =>
      ((await (await fetch(`${server.origin}/api/malleable/plugins`, { headers: asUser(user) })).json()).plugins as Array<{ id: string }>)
        .map((p) => p.id)
        .sort();
    expect(await names('ada')).toEqual(['mine', 'shared']);
    expect(await names('bob')).toEqual(['shared']);
    expect((await fetch(`${server.origin}/api/malleable/plugins/user/mine`, { headers: asUser('bob') })).status).toBe(404);
    expect([401, 403]).toContain((await fetch(`${server.origin}/api/malleable/plugins`, { headers: {} })).status);
  });

  it('validates what it stores', async () => {
    const server = await boot({ REPLAYS_BETA_MALLEABLE: 'true' });
    const content = starter();
    const bad = await fetch(`${server.origin}/api/malleable/approvals`, {
      method: 'POST',
      headers: asUser('ada'),
      body: JSON.stringify({
        action: 'save',
        scope: 'user',
        id: content.manifest.id,
        manifest: { ...content.manifest, permissions: ['network'] },
        source: content.source,
      }),
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/permissions/);
    const mismatch = await save(server, 'ada', 'user', { manifest: { ...content.manifest, id: 'other' }, source: content.source }, 0);
    expect(mismatch.status).toBe(200); // saved under its own id
    const wrongPath = await fetch(`${server.origin}/api/malleable/approvals`, {
      method: 'POST',
      headers: asUser('ada'),
      body: JSON.stringify({ action: 'save', scope: 'user', id: 'x' }),
    });
    expect(wrongPath.status).toBe(400);
  });
});

async function sse(server: RunningServer, token: string) {
  const response = await fetch(`${server.origin}/api/malleable/bridge/events?token=${token}`, { headers: asUser('ada') });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    async nextCall() {
      for (;;) {
        const match = /event: call\ndata: (.*)\n\n/.exec(buffer);
        if (match) {
          buffer = buffer.slice(match.index + match[0].length);
          return JSON.parse(match[1]!) as { id: number; tool: string; arguments: unknown };
        }
        const { value, done } = await reader.read();
        if (done) throw new Error('stream ended');
        buffer += decoder.decode(value);
      }
    },
    close: () => reader.cancel(),
  };
}

describe('the agent bridge', () => {
  it('relays a bearer-authorised call to the paired tab and its answer back, and nothing else', async () => {
    const server = await boot({ REPLAYS_BETA_MALLEABLE: 'true' });
    const pair = await (await fetch(`${server.origin}/api/malleable/bridge/pair`, { method: 'POST', headers: asUser('ada') })).json();
    expect(pair.token).toMatch(/^rb_/);
    const call = (token: string | undefined, tool: string, args: unknown = {}) =>
      fetch(`${server.origin}/api/malleable/bridge/call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ tool, arguments: args }),
      });

    expect((await call(undefined, 'get_app_state')).status).toBe(401);
    expect((await call('rb_nope', 'get_app_state')).status).toBe(401);
    expect((await call(pair.token, 'get_app_state')).status).toBe(503); // nobody is listening yet
    expect((await call(pair.token, 'format_disk')).status).toBe(400); // not a bridge tool

    const stream = await sse(server, pair.token);
    const pending = call(pair.token, 'get_app_state', { x: 1 });
    const incoming = await stream.nextCall();
    expect(incoming).toMatchObject({ tool: 'get_app_state', arguments: { x: 1 } });
    const answered = await fetch(`${server.origin}/api/malleable/bridge/results`, {
      method: 'POST',
      headers: asUser('ada'),
      body: JSON.stringify({ token: pair.token, id: incoming.id, ok: true, result: { replay: 'demo-shop' } }),
    });
    expect(answered.status).toBe(200);
    const result = await pending;
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ result: { replay: 'demo-shop' } });

    // The token is not a session: it opens no other route…
    for (const path of ['/api/malleable/plugins', '/api/replays', '/api/me']) {
      const direct = await fetch(`${server.origin}${path}`, { headers: { authorization: `Bearer ${pair.token}` } });
      expect([401, 403]).toContain(direct.status);
    }
    // …and another person cannot attach to or answer for it.
    expect((await fetch(`${server.origin}/api/malleable/bridge/events?token=${pair.token}`, { headers: asUser('bob') })).status).toBe(404);
    // A tool failure comes back as an error, not a hang.
    const failing = call(pair.token, 'seek', { ms: -1 });
    const next = await stream.nextCall();
    await fetch(`${server.origin}/api/malleable/bridge/results`, {
      method: 'POST',
      headers: asUser('ada'),
      body: JSON.stringify({ token: pair.token, id: next.id, ok: false, error: 'ms must be a non-negative number' }),
    });
    const failed = await failing;
    expect(failed.status).toBe(422);
    // Disconnect revokes.
    await fetch(`${server.origin}/api/malleable/bridge?token=${pair.token}`, { method: 'DELETE', headers: asUser('ada') });
    expect((await call(pair.token, 'get_app_state')).status).toBe(401);
    await stream.close().catch(() => {});
  });

  it('exposes no tool that saves, deletes or grants', () => {
    const names = BRIDGE_TOOLS.map((tool) => tool.name);
    expect(names).toContain('install_plugin_draft');
    expect(names).toContain('request_keep');
    expect(names.filter((name) => /save|delete|grant|approve|keep_plugin/.test(name))).toEqual([]);
    for (const tool of BRIDGE_TOOLS) {
      expect(tool.annotations.readOnlyHint).toBeTypeOf('boolean');
      expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    }
  });
});

const fake = (handler: (url: string, init: RequestInit) => { status?: number; body: unknown }) =>
  (async (url: string, init: RequestInit) => {
    const { status = 200, body } = handler(url, init);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;

describe('the MCP server', () => {
  it('negotiates, lists the shared tools and relays calls with the bearer token', async () => {
    const seen: Array<{ url: string; auth: string | null; body: unknown }> = [];
    const server = new McpServer({
      url: 'http://127.0.0.1:1/replays/',
      token: 'rb_test',
      fetch: fake((url, init) => {
        seen.push({ url, auth: new Headers(init.headers).get('authorization'), body: JSON.parse(String(init.body)) });
        return { body: { result: { ok: true } } };
      }),
    });
    const init = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
    expect(init).toMatchObject({
      id: 1,
      result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'replays' } },
    });
    expect(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeUndefined();
    const list = (await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as { result: { tools: Array<{ name: string }> } };
    expect(list.result.tools.map((tool) => tool.name)).toEqual(BRIDGE_TOOLS.map((tool) => tool.name));
    const called = (await server.handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_app_state', arguments: {} },
    })) as {
      result: { isError: boolean; structuredContent: unknown };
    };
    expect(called.result).toMatchObject({ isError: false, structuredContent: { ok: true } });
    expect(seen).toEqual([
      {
        url: 'http://127.0.0.1:1/replays/api/malleable/bridge/call',
        auth: 'Bearer rb_test',
        body: { tool: 'get_app_state', arguments: {} },
      },
    ]);
    expect(await server.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'rm_rf' } })).toMatchObject({
      error: { code: -32602 },
    });
    expect(await server.handle({ jsonrpc: '2.0', id: 5, method: 'nope' })).toMatchObject({ error: { code: -32601 } });
  });

  it('reports a refused or unreachable bridge as a tool error the agent can read', async () => {
    const refused = new McpServer({
      url: 'http://x',
      token: 't',
      fetch: fake(() => ({ status: 503, body: { error: 'no viewer is connected' } })),
    });
    const answer = (await refused.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_app_state' } })) as {
      result: { isError: boolean; content: Array<{ text: string }> };
    };
    expect(answer.result.isError).toBe(true);
    expect(answer.result.content[0]!.text).toContain('no viewer is connected');
    const down = new McpServer({
      url: 'http://x',
      token: 't',
      fetch: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    const gone = (await down.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_app_state' } })) as {
      result: { isError: boolean };
    };
    expect(gone.result.isError).toBe(true);
  });
});

describe('the plugin format', () => {
  it('accepts the starter and round-trips a file', () => {
    const { manifest, source } = starterPlugin();
    expect(parseManifest(manifest)).toEqual(manifest);
    const file = pluginFile(manifest, source);
    expect(parsePluginFile(JSON.parse(JSON.stringify(file)))).toEqual(file);
  });

  it('rejects what it should', () => {
    const { manifest } = starterPlugin();
    const bad = (patch: Record<string, unknown>) => () => parseManifest({ ...manifest, ...patch });
    expect(bad({ id: 'Bad Id' })).toThrow(PluginFormatError);
    expect(bad({ permissions: ['network'] })).toThrow(/permissions/);
    expect(bad({ contributes: {} })).toThrow(/at least one/);
    expect(
      bad({
        contributes: {
          tabs: [
            { id: 'a', label: 'A' },
            { id: 'a', label: 'B' },
          ],
        },
      }),
    ).toThrow(/twice/);
    expect(bad({ extra: 1 })).toThrow(/not a supported field/);
    expect(() => parsePluginFile({ format: 'replays-user-plugin/1', manifest, source: '   ' })).toThrow(/empty/);
    expect(() => parsePluginFile({ format: 'other', manifest, source: 'x' })).toThrow(/format/);
  });

  it('diffs lines', () => {
    const diff = diffLines('a\nb\nc', 'a\nB\nc\nd');
    expect(diff.filter((line) => line.kind !== 'same').map((line) => `${line.kind}:${line.text}`)).toEqual(['del:b', 'add:B', 'add:d']);
    expect(diffLines('same', 'same').every((line) => line.kind === 'same')).toBe(true);
  });
});
