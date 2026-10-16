import type { PluginHistory, PluginScope, PluginSummary, UserPluginManifest } from '../../shared/malleable.ts';
import { apiUrl } from '../route.ts';

export class MalleableRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'MalleableRequestError';
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(apiUrl(`malleable/${path}`), {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const parsed = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new MalleableRequestError(parsed.error ?? `Request failed (${response.status})`, response.status);
  return parsed;
}

export const listPlugins = async () => (await request<{ plugins: PluginSummary[] }>('GET', 'plugins')).plugins;
export const getHistory = (scope: PluginScope, id: string) => request<PluginHistory>('GET', `plugins/${scope}/${id}`);

/** Only the approval dialog calls these two (src/client/malleable/KeepDialog.tsx): the token is the person's yes. */
export const mintApproval = async (input: {
  action: 'save' | 'delete';
  scope: PluginScope;
  id: string;
  manifest?: UserPluginManifest;
  source?: string;
}) => (await request<{ token: string }>('POST', 'approvals', input)).token;

export const savePlugin = (
  scope: PluginScope,
  id: string,
  input: { manifest: UserPluginManifest; source: string; message: string; baseVersion: number; approval: string },
) => request<{ version: number }>('PUT', `plugins/${scope}/${id}`, input);

export const deletePlugin = (scope: PluginScope, id: string, approval: string) =>
  request<{ removed: boolean }>('DELETE', `plugins/${scope}/${id}?approval=${encodeURIComponent(approval)}`);

export const pairBridge = () => request<{ token: string; expiresAt: string }>('POST', 'bridge/pair');
export const revokeBridge = (token: string) => request<{ revoked: boolean }>('DELETE', `bridge?token=${encodeURIComponent(token)}`);
export const answerBridge = (token: string, id: number, outcome: { ok: boolean; result?: unknown; error?: string }) =>
  request<{ ok: boolean }>('POST', 'bridge/results', { token, id, ...outcome });
export const bridgeEventsUrl = (token: string) => apiUrl(`malleable/bridge/events?token=${encodeURIComponent(token)}`);
