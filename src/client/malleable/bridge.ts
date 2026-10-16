import { useSyncExternalStore } from 'react';

import { answerBridge, bridgeEventsUrl, pairBridge, revokeBridge } from './api.ts';
import { toolHandlers } from './tools.ts';

/**
 * The page's end of the out-of-page agent bridge (the server's end is src/server/bridge-hub.ts; the agent-facing end is the
 * MCP server in src/mcp/). The person clicks "Connect an agent": the page asks for a token, listens on a server-sent-events
 * stream and answers each tool call with the same handlers WebMCP uses. The token lives in memory only; closing the tab or
 * "Disconnect" revokes it. The activity list is what the agent did, shown to the person.
 */
export interface BridgeActivity {
  at: number;
  tool: string;
  ok: boolean;
  summary: string;
}

export interface BridgeState {
  status: 'off' | 'connecting' | 'connected';
  token?: string;
  activity: readonly BridgeActivity[];
}

let state: BridgeState = { status: 'off', activity: [] };
let source: EventSource | undefined;
const listeners = new Set<() => void>();
const set = (patch: Partial<BridgeState>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};
export const useBridge = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );

function record(tool: string, ok: boolean, summary: string) {
  set({ activity: [...state.activity, { at: Date.now(), tool, ok, summary: summary.slice(0, 160) }].slice(-50) });
}

export async function connectAgent() {
  disconnectAgent();
  set({ status: 'connecting', activity: [] });
  const { token } = await pairBridge();
  const stream = new EventSource(bridgeEventsUrl(token));
  source = stream;
  stream.addEventListener('open', () => set({ status: 'connected' }));
  stream.addEventListener('call', (event) => {
    const call = JSON.parse((event as MessageEvent<string>).data) as { id: number; tool: string; arguments: Record<string, unknown> };
    void (async () => {
      try {
        const handler = toolHandlers[call.tool];
        if (!handler) throw new Error(`unknown tool ${call.tool}`);
        const result = await handler(call.arguments ?? {});
        record(call.tool, true, JSON.stringify(call.arguments ?? {}));
        await answerBridge(token, call.id, { ok: true, result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        record(call.tool, false, message);
        await answerBridge(token, call.id, { ok: false, error: message }).catch(() => {});
      }
    })();
  });
  set({ token });
  return token;
}

export function disconnectAgent() {
  source?.close();
  source = undefined;
  const token = state.token;
  if (token) void revokeBridge(token).catch(() => {});
  set({ status: 'off', activity: state.activity });
  const { token: _token, ...rest } = state;
  state = rest;
}
