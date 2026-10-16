import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

/**
 * A scripted stand-in for a coding agent, for CI: no model, no API key. It is a real MCP client: it starts the repository's
 * `replays mcp` server over stdio and speaks JSON-RPC to it, exactly as Claude Code or Codex would. What it does not have is a
 * language model, so `writePlugin` is a fixed function from the request to a plugin; the test still proves everything around
 * it (discovery, install, repair loop, the keep dialog).
 */
export class FakeAgent {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly waiting = new Map<number, (message: Record<string, any>) => void>();
  private next = 1;
  stderr = '';

  constructor(url: string, token: string) {
    this.child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', 'src/cli.ts', 'mcp'], {
      cwd: resolve(import.meta.dirname, '..'),
      env: { ...process.env, REPLAYS_URL: url, REPLAYS_BRIDGE_TOKEN: token },
    });
    this.child.stderr.on('data', (chunk) => (this.stderr += chunk.toString()));
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      const message = JSON.parse(line) as Record<string, any>;
      this.waiting.get(message.id)?.(message);
    });
  }

  private request(method: string, params?: unknown): Promise<Record<string, any>> {
    const id = this.next++;
    return new Promise((done) => {
      this.waiting.set(id, done);
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async initialize() {
    const init = await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'fake-agent', version: '0' },
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    return init.result;
  }

  async listTools(): Promise<Array<{ name: string }>> {
    return (await this.request('tools/list')).result.tools;
  }

  /** Calls a tool; returns the parsed JSON result, or `{ error }` when the tool failed. */
  async call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const response = await this.request('tools/call', { name, arguments: args });
    if (response.error) return { error: response.error.message };
    const text: string = response.result.content[0].text;
    if (response.result.isError) return { error: text };
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  }

  stop() {
    this.child.kill();
  }
}

/** The "model": turns the request into a plugin, using what the agent learned from the viewer (the failing URLs it saw). */
export function writeFailedByEndpointPlugin() {
  return {
    manifest: {
      format: 'replays-user-plugin/1',
      id: 'failed-by-endpoint',
      name: 'Failed by endpoint',
      description: 'Groups failed requests (status 400+ or no response) by method and endpoint.',
      permissions: ['replay:read', 'playback:seek'],
      contributes: { tabs: [{ id: 'main', label: 'Failed' }] },
    },
    source: `// Groups failed requests by endpoint. Ids in the path (numbers, hashes, CODES1) become :id.
const SEGMENT_ID = /^(\\d+|[0-9a-f-]{8,}|[A-Z]+\\d+)$/;
function endpointOf(request) {
  let path;
  try { path = new URL(request.url).pathname; } catch { path = request.url; }
  return request.method + ' ' + path.split('/').map((s) => (SEGMENT_ID.test(s) ? ':id' : s)).join('/');
}

replays.tab('main', (el, ctx) => {
  const failed = ctx.replay.network.filter((r) => r.status >= 400 || r.status === 0);
  const groups = new Map();
  for (const r of failed) {
    const key = endpointOf(r);
    const g = groups.get(key) || { key, count: 0, statuses: new Set(), first: r.at };
    g.count++;
    g.statuses.add(r.status);
    g.first = Math.min(g.first, r.at);
    groups.set(key, g);
  }
  el.replaceChildren();
  const title = document.createElement('h3');
  title.textContent = failed.length + ' failed requests in ' + groups.size + ' endpoints';
  title.dataset.testid = 'summary';
  el.append(title);
  if (!groups.size) { el.append('Nothing failed in this replay.'); return; }
  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>Endpoint</th><th>Failures</th><th>Status</th><th>First</th></tr></thead>';
  const body = document.createElement('tbody');
  for (const g of [...groups.values()].sort((a, b) => b.count - a.count)) {
    const row = document.createElement('tr');
    row.dataset.endpoint = g.key;
    const cells = [g.key, String(g.count), [...g.statuses].join(', ')];
    for (const text of cells) { const td = document.createElement('td'); td.textContent = text; row.append(td); }
    const td = document.createElement('td');
    const button = document.createElement('button');
    button.textContent = (g.first / 1000).toFixed(1) + ' s';
    button.addEventListener('click', () => ctx.seek(g.first));
    td.append(button);
    row.append(td);
    body.append(row);
  }
  table.append(body);
  el.append(table);
});
`,
  };
}
