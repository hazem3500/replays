import type WebSocket from 'ws';
import type { RawData } from 'ws';

import type { CdpLike } from './session.ts';

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message?: string };
  sessionId?: string;
}

type EventHandler = (message: CdpMessage) => void;

export class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  private readonly handlers = new Set<EventHandler>();

  private readonly socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (raw) => this.onMessage(raw));
    socket.on('close', () => this.failPending(new Error('CDP connection closed')));
    socket.on('error', (error) => this.failPending(error));
  }

  static async connect(url: string) {
    // why: ws is only needed to reach a browser over a socket; the library entry records through Playwright and never loads it.
    const { default: Socket } = await import('ws');
    const socket = new Socket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    return new CdpClient(socket);
  }

  private onMessage(raw: RawData) {
    const message = JSON.parse(raw.toString()) as CdpMessage;
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? 'CDP command failed'));
      else pending.resolve(message.result ?? {});
      return;
    }
    for (const handler of this.handlers) handler(message);
  }

  private failPending(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
    const id = this.nextId++;
    const message = { id, method, params, ...(sessionId ? { sessionId } : {}) };
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(message), (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  onEvent(handler: EventHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** A `CdpLike` (session.ts) bound to one attached target: commands and events of that session only. */
  forSession(sessionId: string): CdpLike {
    const wrapped = new Map<(params: Record<string, unknown>) => void, EventHandler>();
    return {
      send: (method, params) => this.send(method, params ?? {}, sessionId),
      on: (event, handler) => {
        const listener: EventHandler = (message) => {
          if (message.method === event && message.sessionId === sessionId) handler(message.params ?? {});
        };
        wrapped.set(handler, listener);
        this.handlers.add(listener);
      },
      off: (_event, handler) => {
        const listener = wrapped.get(handler);
        if (listener) this.handlers.delete(listener);
        wrapped.delete(handler);
      },
    };
  }

  async attachToPage() {
    const result = await this.send('Target.getTargets');
    const targets = result.targetInfos as Array<{ targetId: string; type: string; url: string }> | undefined;
    const pages = targets?.filter((candidate) => candidate.type === 'page') ?? [];
    const target =
      pages.find((candidate) => candidate.url === 'about:blank') ??
      pages.find((candidate) => !candidate.url.startsWith('chrome://')) ??
      pages.at(-1);
    if (!target) throw new Error('the browser did not expose a page target');
    const attached = await this.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const sessionId = String(attached.sessionId ?? '');
    if (!sessionId) throw new Error('CDP did not return a target session');
    await this.send('Runtime.enable', {}, sessionId);
    await this.send('Page.enable', {}, sessionId);
    return sessionId;
  }

  close() {
    this.socket.close();
  }
}

export function cdpValue(result: Record<string, unknown>) {
  const remote = result.result as { value?: unknown; exceptionDetails?: unknown } | undefined;
  if (remote?.exceptionDetails) throw new Error('Replay recorder evaluation failed');
  return remote?.value;
}
