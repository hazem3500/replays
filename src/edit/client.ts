import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { CliAuthError } from '../capture/device-auth.ts';
import { assertStoredReplayEdits, type ReplayEdits, type StoredReplayEdits } from '../shared/edits.ts';
import type { ReplayBundle } from '../shared/replay.ts';
import { renderQuery } from '../shared/render-variant.ts';
import { EditError } from './errors.ts';

export type Headers = Record<string, string>;

export interface EditsRead {
  edits: StoredReplayEdits;
  etag: string;
}

export type SaveResult = { status: 'saved'; edits: StoredReplayEdits; etag: string } | { status: 'conflict'; current: EditsRead };

/** What read-modify-write needs from the server; the HTTP client below and the tests' fakes both provide it. */
export interface EditsApi {
  getEdits(): Promise<EditsRead>;
  putEdits(edits: ReplayEdits, etag: string): Promise<SaveResult>;
}

export interface RenderParams {
  speed: number;
  captions: boolean;
  skipInactive: boolean;
  /** The edit list version (editsVersion) the export applies; '' for as recorded. */
  edits: string;
}

export interface RenderJob {
  status: 'queued' | 'rendering' | 'done' | 'failed' | 'none' | 'unavailable' | 'refused';
  progress?: number;
  etaMs?: number;
  error?: string;
  reason?: string;
  size?: number;
}

const TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

async function errorText(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') return body.error;
  } catch {
    // why: plain-text bodies (the app's own 403s) are the message as they are.
  }
  return text.trim().slice(0, 200);
}

export class EditClient implements EditsApi {
  readonly server: string;
  readonly id: string;
  readonly #headers: () => Promise<Headers>;
  readonly #fetch: typeof fetch;
  readonly #authNote: string;

  constructor(options: { server: string; id: string; headers: () => Promise<Headers>; fetch?: typeof fetch; authNote?: string }) {
    this.server = options.server;
    this.id = options.id;
    this.#headers = options.headers;
    this.#fetch = options.fetch ?? fetch;
    this.#authNote = options.authNote ?? 'run `replays login`';
  }

  get link() {
    return `${this.server}/r/${this.id}`;
  }

  #url(path = '') {
    return `${this.server}/api/replays/${this.id}${path}`;
  }

  async #send(url: string, init: RequestInit & { timeout?: number } = {}): Promise<Response> {
    const { timeout = TIMEOUT_MS, ...rest } = init;
    let response: Response;
    try {
      response = await this.#fetch(url, {
        ...rest,
        headers: { accept: 'application/json', ...(await this.#headers()), ...(rest.headers as Headers | undefined) },
        redirect: 'manual',
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      if (error instanceof EditError || error instanceof CliAuthError) throw error;
      throw new EditError(`could not reach ${this.server}; check the server address (\`replays config\`) and your network connection`);
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new EditError(`${this.server} redirected the request; save the final address with \`replays connect <url>\``);
    }
    if (response.status === 401) {
      await response.body?.cancel();
      throw new CliAuthError(`the server did not accept this sign-in (401); ${this.#authNote}, then try again`, 3);
    }
    return response;
  }

  async #fail(response: Response, doing: string): Promise<never> {
    const detail = await errorText(response);
    const status = response.status;
    if (status === 404 && /replay not found/i.test(detail)) throw new EditError(`no replay ${this.id} on ${this.server}`);
    if (status === 404)
      throw new EditError(
        `${this.server} has the replay editor turned off, so edits cannot be ${doing}; the server owner enables it with REPLAYS_BETA_EDITOR=true`,
      );
    if (status === 403 && /turned off/i.test(detail))
      throw new EditError(`editing is turned off on ${this.server}; edits can be read but not saved (EDITING_ENABLED=false)`);
    if (status === 403 && /rename/i.test(detail))
      throw new EditError(
        'only the people listed on this replay (matched by your sign-in email) or an admin can rename steps. Every other edit is open to anyone who can open the replay',
      );
    if (status === 403)
      throw new EditError(
        `the server refused this (403${detail ? `: ${detail}` : ''}); your account may not be allowed to edit this replay`,
      );
    if (status === 413) throw new EditError('the edit list is too large for the server (256 KB limit)');
    if (status >= 500) throw new EditError(`the server had a problem (${status}); try again in a moment`);
    throw new EditError(`the server answered ${status}${detail ? `: ${detail}` : ''}`);
  }

  async bundle(): Promise<ReplayBundle> {
    const response = await this.#send(this.#url());
    if (response.status === 404) {
      await response.body?.cancel();
      throw new EditError(`no replay ${this.id} on ${this.server}`);
    }
    if (!response.ok) return this.#fail(response, 'read');
    const bundle = (await response.json().catch(() => undefined)) as ReplayBundle | undefined;
    if (!bundle?.meta || !Array.isArray(bundle.steps) || !Array.isArray(bundle.events))
      throw new EditError(`${this.server} did not return a replay for ${this.id}`);
    return bundle;
  }

  async getEdits(): Promise<EditsRead> {
    const response = await this.#send(this.#url('/edits'));
    if (!response.ok) return this.#fail(response, 'read');
    return this.#readEdits(response);
  }

  async #readEdits(response: Response, body?: unknown): Promise<EditsRead> {
    const value = body ?? (await response.json().catch(() => undefined));
    try {
      assertStoredReplayEdits(value);
    } catch (error) {
      throw new EditError(`the server returned an edit list this CLI cannot read (${(error as Error).message}); update the CLI`);
    }
    const etag = response.headers.get('etag');
    if (!etag) throw new EditError('the server returned edits without an ETag, so they cannot be saved safely');
    return { edits: value, etag };
  }

  async putEdits(edits: ReplayEdits, etag: string): Promise<SaveResult> {
    const response = await this.#send(this.#url('/edits'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'if-match': etag },
      body: JSON.stringify(edits),
    });
    if (response.status === 409) {
      const body: unknown = await response.json().catch(() => undefined);
      const current = typeof body === 'object' && body !== null && 'current' in body ? body.current : undefined;
      if (!current) throw new EditError('the server reported a conflict without the current edits; run pull and try again');
      return { status: 'conflict', current: await this.#readEdits(response, current) };
    }
    if (response.status === 400 || response.status === 422)
      throw new EditError(`the server refused the edits: ${(await errorText(response)) || response.status}`, 2);
    if (!response.ok) return this.#fail(response, 'saved');
    const saved = await this.#readEdits(response);
    return { status: 'saved', ...saved };
  }

  #query(params: RenderParams) {
    return renderQuery({ speed: params.speed, captions: params.captions, skipInactive: params.skipInactive, edits: params.edits });
  }

  async startRender(params: RenderParams): Promise<RenderJob> {
    const response = await this.#send(this.#url('/render'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        speed: params.speed,
        captions: params.captions,
        skipInactive: params.skipInactive,
        ...(params.edits ? { edits: params.edits } : {}),
      }),
    });
    return this.#job(response);
  }

  async renderStatus(params: RenderParams): Promise<RenderJob> {
    return this.#job(await this.#send(this.#url(`/render${this.#query(params)}`)));
  }

  async #job(response: Response): Promise<RenderJob> {
    if (response.status === 503) {
      const body: unknown = await response.json().catch(() => ({}));
      const reason = typeof body === 'object' && body !== null && 'reason' in body ? String(body.reason) : '';
      throw new EditError(`${this.server} cannot render videos${reason ? ` (${reason})` : ''}; it needs Chromium and ffmpeg`);
    }
    if (response.status === 409)
      throw new EditError('the edits changed while exporting; run the export again to render the current version');
    if (response.status === 422 || response.status === 429 || response.status === 400)
      throw new EditError((await errorText(response)) || `the server refused the export (${response.status})`);
    if (response.status === 403) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new EditError(`the server refused this export${body.error ? `: ${body.error}` : ''}`);
    }
    if (!response.ok) return this.#fail(response, 'exported');
    return (await response.json()) as RenderJob;
  }

  /** Streams the finished video to `file` (written next to it first, then moved into place). Returns its size in bytes. */
  async downloadRender(params: RenderParams, file: string): Promise<number> {
    const response = await this.#send(this.#url(`/render/file${this.#query(params)}`), { timeout: DOWNLOAD_TIMEOUT_MS });
    if (response.status === 404) throw new EditError('the server has no finished video for these options; run the export again');
    if (!response.ok || !response.body) return this.#fail(response, 'exported');
    const partial = `${file}.part`;
    try {
      await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(partial));
      await rename(partial, file);
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
    return Number(response.headers.get('content-length')) || 0;
  }
}
