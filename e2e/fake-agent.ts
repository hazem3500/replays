import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
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

/**
 * The "model": turns the request ("add a tab that groups failed requests by endpoint") into a plugin. A fixed function here; the
 * file is the shipped example, so the docs, the tests and the screenshots all show the same plugin.
 */
export function writeFailedByEndpointPlugin(): { manifest: Record<string, any>; source: string } {
  const file = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../examples/malleable/failed-by-endpoint.replays-plugin.json'), 'utf8'),
  );
  return { manifest: file.manifest, source: file.source };
}
