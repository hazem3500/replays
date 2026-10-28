import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';

/**
 * The agent bridge's relay. A viewer tab *pairs* (the person clicks "Connect an agent"): the server mints a bearer token for
 * that one tab. The tab listens on a server-sent-events stream; an agent (through the MCP server, src/mcp/) posts a tool call
 * with the token; the hub forwards it down the stream and hands back whatever the tab answers. So the agent reaches exactly
 * what the tab's own tool handlers allow, with the tab's permission prompts in the way, and nothing else: the token is not a
 * session, and no other route accepts it.
 */
const SESSION_TTL_MS = 8 * 60 * 60_000;
const CALL_TIMEOUT_MS = 30_000;
const MAX_SESSIONS_PER_IDENTITY = 4;
const MAX_PENDING = 16;

interface Session {
  identity: string;
  expires: number;
  sink?: ServerResponse | undefined;
  pending: Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>;
  next: number;
  heartbeat?: NodeJS.Timeout | undefined;
}

export class BridgeError extends Error {
  readonly status: number;
  readonly expose = true;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'BridgeError';
    this.status = status;
  }
}

export class BridgeHub {
  private readonly sessions = new Map<string, Session>();
  private readonly now: () => number;
  private readonly callTimeoutMs: number;

  constructor(options: { now?: () => number; callTimeoutMs?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.callTimeoutMs = options.callTimeoutMs ?? CALL_TIMEOUT_MS;
  }

  pair(identity: string) {
    const mine = [...this.sessions].filter(([, session]) => session.identity === identity);
    while (mine.length >= MAX_SESSIONS_PER_IDENTITY) this.revoke(mine.shift()![0]);
    const token = `rb_${randomBytes(24).toString('base64url')}`;
    const expires = this.now() + SESSION_TTL_MS;
    this.sessions.set(token, { identity, expires, pending: new Map(), next: 1 });
    return { token, expiresAt: new Date(expires).toISOString() };
  }

  private session(token: unknown): Session | undefined {
    if (typeof token !== 'string') return undefined;
    const session = this.sessions.get(token);
    if (!session) return undefined;
    if (session.expires <= this.now()) {
      this.revoke(token);
      return undefined;
    }
    return session;
  }

  /** The tab's stream. Only the person who paired may attach; a second attach replaces the first. */
  attach(token: unknown, identity: string, response: ServerResponse) {
    const session = this.session(token);
    if (!session || session.identity !== identity) throw new BridgeError(404, 'unknown bridge token');
    this.detach(session);
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    response.write('retry: 2000\n\n: connected\n\n');
    session.sink = response;
    session.heartbeat = setInterval(() => response.write(': ping\n\n'), 15_000);
    response.once('close', () => {
      if (session.sink === response) this.detach(session);
    });
  }

  private detach(session: Session) {
    if (session.heartbeat) clearInterval(session.heartbeat);
    session.heartbeat = undefined;
    const sink = session.sink;
    session.sink = undefined;
    sink?.end();
    for (const [id, call] of session.pending) {
      clearTimeout(call.timer);
      call.reject(new BridgeError(503, 'the viewer disconnected'));
      session.pending.delete(id);
    }
  }

  connected(token: unknown) {
    return Boolean(this.session(token)?.sink);
  }

  /** An agent's call: forwarded to the tab, resolved by `answer`. */
  call(token: unknown, tool: string, args: unknown): Promise<unknown> {
    const session = this.session(token);
    if (!session) return Promise.reject(new BridgeError(401, 'unknown or expired bridge token'));
    if (!session.sink) return Promise.reject(new BridgeError(503, 'no viewer is connected: open a replay and use "Connect an agent"'));
    if (session.pending.size >= MAX_PENDING) return Promise.reject(new BridgeError(429, 'too many calls in flight'));
    const id = session.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(id);
        reject(new BridgeError(504, `the viewer did not answer ${tool} in time`));
      }, this.callTimeoutMs);
      session.pending.set(id, { resolve, reject, timer });
      session.sink!.write(`event: call\ndata: ${JSON.stringify({ id, tool, arguments: args ?? {} })}\n\n`);
    });
  }

  /** The tab's answer to call `id`. */
  answer(token: unknown, identity: string, id: unknown, outcome: { ok: boolean; result?: unknown; error?: string }) {
    const session = this.session(token);
    if (!session || session.identity !== identity) throw new BridgeError(404, 'unknown bridge token');
    const call = typeof id === 'number' ? session.pending.get(id) : undefined;
    if (!call) throw new BridgeError(404, 'no such call');
    clearTimeout(call.timer);
    session.pending.delete(id as number);
    if (outcome.ok) call.resolve(outcome.result);
    else call.reject(new BridgeError(422, outcome.error ?? 'the tool failed'));
  }

  revoke(token: string) {
    const session = this.sessions.get(token);
    if (!session) return;
    this.detach(session);
    this.sessions.delete(token);
  }

  close() {
    for (const token of Array.from(this.sessions.keys())) this.revoke(token);
  }
}
