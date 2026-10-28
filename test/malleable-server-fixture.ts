import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { definePlugin } from '../src/plugin/index.ts';
import type { ReplaysPlugin } from '../src/plugin/types.ts';
import type { FileConfig } from '../src/server/config.ts';
import { startServer, type RunningServer } from '../src/server/start.ts';
import { isRecord } from '../src/shared/plugin-validation.ts';

const running: RunningServer[] = [];
export async function closeServers(): Promise<void> {
  await Promise.all(running.splice(0).map((server) => server.close()));
}
export const who = definePlugin({
  name: 'who',
  setup(api) {
    api.auth({
      name: 'who-am-i',
      authenticate(request) {
        const id = request.headers['x-who'];
        return typeof id === 'string' ? { id, name: id, roles: id === 'ada' ? ['admin'] : ['member'] } : undefined;
      },
    });
  },
});
export async function boot(
  env: Record<string, string> = {},
  plugins: ReplaysPlugin[] = [who],
  file: FileConfig = {},
): Promise<RunningServer> {
  const server = await startServer({
    env: { DATA_DIR: await mkdtemp(join(tmpdir(), 'replays-mall-')), POSTERS_DISABLED: '1', RENDER_DISABLED: '1', ...env },
    port: 0,
    config: { dir: process.cwd(), file, plugins: [] },
    plugins,
    log: () => {},
  });
  running.push(server);
  return server;
}
export const asUser = (name: string): Record<string, string> => ({ 'x-who': name, 'content-type': 'application/json' });
interface ApprovalInput {
  action: 'save' | 'delete';
  scope: string;
  id: string;
  content?: { manifest: unknown; source: string };
}
export async function approval(server: RunningServer, user: string, input: ApprovalInput): Promise<string> {
  const response = await fetch(`${server.origin}/api/malleable/approvals`, {
    method: 'POST',
    headers: asUser(user),
    body: JSON.stringify({ action: input.action, scope: input.scope, id: input.id, ...input.content }),
  });
  if (response.status !== 200) throw new Error(`expected approval, got ${response.status}`);
  const body: unknown = await response.json();
  if (!isRecord(body) || typeof body.token !== 'string') throw new Error('approval token missing');
  return body.token;
}

interface SaveInput {
  scope: string;
  content: { manifest: { id: string }; source: string };
  baseVersion: number;
  message?: string;
}
export async function savePlugin(server: RunningServer, user: string, input: SaveInput): Promise<Response> {
  const { content, scope, baseVersion, message = '' } = input;
  const token = await approval(server, user, { action: 'save', scope, id: content.manifest.id, content });
  return fetch(`${server.origin}/api/malleable/plugins/${scope}/${content.manifest.id}`, {
    method: 'PUT',
    headers: asUser(user),
    body: JSON.stringify({ ...content, baseVersion, message, approval: token }),
  });
}
