import { createInterface } from 'node:readline';

import { McpServer } from './server.ts';

const USAGE = `replays mcp — MCP server (stdio) for the plugin workshop's agent bridge

  REPLAYS_URL=http://127.0.0.1:8080 REPLAYS_BRIDGE_TOKEN=rb_… replays mcp
  replays mcp --url http://127.0.0.1:8080 --token rb_…

Open a replay with REPLAYS_BETA_MALLEABLE=true, Plugin workshop → Agent → Connect an agent, and copy the token.`;

export async function runMcpCli(args: string[]) {
  const flag = (name: string) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const url = flag('url') ?? process.env.REPLAYS_URL;
  const token = flag('token') ?? process.env.REPLAYS_BRIDGE_TOKEN;
  if (!url || !token) {
    process.stderr.write(`replays mcp: set REPLAYS_URL and REPLAYS_BRIDGE_TOKEN (or --url and --token)\n\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const server = new McpServer({ url, token });
  const lines = createInterface({ input: process.stdin });
  const inflight = new Set<Promise<void>>();
  lines.on('line', (line) => {
    if (!line.trim()) return;
    const work = (async () => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })}\n`);
        return;
      }
      const answer = await server.handle(message);
      if (answer) process.stdout.write(`${JSON.stringify(answer)}\n`);
    })().finally(() => inflight.delete(work));
    inflight.add(work);
  });
  await new Promise<void>((done) => lines.once('close', done));
  await Promise.allSettled(inflight);
}
