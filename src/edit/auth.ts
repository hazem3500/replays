import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { refreshIfNeeded, identityLabel } from '../capture/upload.ts';
import { beginDeviceLogin, CliAuthError, fetchCliAuthCapability, tokenFromResponse } from '../capture/device-auth.ts';
import { loadCliToken, saveCliToken } from '../capture/credentials.ts';
import { normalizeServerUrl, resolveServerUrl } from '../capture/server-config.ts';
import { EditError, isRecord, messageOf, must, usageError } from './errors.ts';
import type { Headers } from './client.ts';

const REPLAY_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const LINK = /^(.*?)(?:\/s\/[^/]+)?\/r\/([a-z0-9][a-z0-9-]{0,79})\/?$/;

export interface TargetOptions {
  serverName?: string;
  headerFile?: string;
  env: NodeJS.ProcessEnv;
  /** Sign in interactively when no saved sign-in exists (a terminal, and not --json). */
  interactive: boolean;
  /**
   * A wrapper that attaches its own credentials (the Toggl wrapper's IAP headers) names the one server it approves; a
   * target on any other server is refused, as `trustedUploadUrl` does for uploads.
   */
  trustedServerUrl?: string;
  configPath?: string;
}

export interface EditTarget {
  server: string;
  id: string;
  headers: () => Promise<Headers>;
  authNote: string;
}

async function readHeaderFile(path: string): Promise<Headers> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolve(path), 'utf8'));
  } catch {
    throw usageError('--header-file must be a readable JSON file');
  }
  if (!isRecord(parsed)) throw usageError('--header-file must contain a JSON object with string header values');
  const headers: Headers = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') throw usageError('--header-file must contain a JSON object with string header values');
    headers[name] = value;
  }
  return headers;
}

async function bearerHeaders(server: string, options: TargetOptions): Promise<Headers> {
  let auth: Awaited<ReturnType<typeof fetchCliAuthCapability>>;
  try {
    auth = await fetchCliAuthCapability(server);
  } catch (error) {
    if (error instanceof CliAuthError && /\((404|401|403)\)/.test(error.message)) return {};
    throw error;
  }
  if (auth.auth === 'none' || !auth.deviceFlow) return {};
  const flow = auth.deviceFlow;
  const available = await refreshIfNeeded(server, flow, await loadCliToken(server, flow.issuer, flow.clientId));
  let token = available?.cached;
  if (!token) {
    const named = options.serverName ? ` --server ${options.serverName}` : '';
    if (!options.interactive)
      throw new CliAuthError(`sign in is required for ${server}; run \`replays login${named}\` in an interactive terminal`, 3);
    const authorized = await beginDeviceLogin(server, flow);
    token = tokenFromResponse(server, flow, authorized.token, authorized.status);
    await saveCliToken(token);
    process.stderr.write(`Signed in to ${server} as ${identityLabel(authorized.status)}.\n`);
  }
  return { authorization: `Bearer ${token.accessToken}` };
}

/**
 * The server, replay id and credentials for `<id|url>`. A bare id uses the saved (or `--server`, REPLAYS_SERVER_URL)
 * server; a viewer link names its own. Credentials: `--header-file` as given, else the saved CLI sign-in when the server is
 * the one `replays connect` saved; any other server is reached anonymously.
 */
export async function resolveTarget(raw: string, options: TargetOptions): Promise<EditTarget> {
  const saved = async () => {
    try {
      return await resolveServerUrl({
        ...(options.serverName ? { explicitName: options.serverName } : {}),
        env: options.env,
        ...(options.configPath ? { path: options.configPath } : {}),
      });
    } catch (error) {
      if (options.serverName || options.env.REPLAYS_SERVER_URL || !/no server named/.test(messageOf(error))) throw error;
      return;
    }
  };
  const configured = options.trustedServerUrl ? undefined : await saved();
  let server: string;
  let id: string;
  if (/^https?:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw usageError(`"${raw}" is not a replay link`);
    }
    const match = LINK.exec(`${url.origin}${url.pathname}`);
    if (!match) throw usageError(`"${raw}" is not a replay link; it should end in /r/<id>`);
    server = normalizeServerUrl(must(match[1]));
    id = must(match[2]);
  } else {
    if (!REPLAY_ID.test(raw)) throw usageError(`"${raw}" is not a replay id or a viewer link`);
    id = raw;
    if (!configured && !options.trustedServerUrl)
      throw new EditError('no server is configured; run `replays connect <server-url>` or pass a viewer link');
    server = normalizeServerUrl(options.trustedServerUrl ?? must(configured).url);
  }
  if (options.trustedServerUrl && normalizeServerUrl(options.trustedServerUrl) !== server)
    throw usageError(`this command only edits replays on ${normalizeServerUrl(options.trustedServerUrl)}`);

  const savedMatch = configured !== undefined && normalizeServerUrl(configured.url) === server;
  let cached: Headers | undefined;
  const headers = async () => {
    if (cached) return cached;
    if (options.headerFile) cached = await readHeaderFile(options.headerFile);
    else if (savedMatch) cached = await bearerHeaders(server, options);
    else cached = {};
    return cached;
  };
  const named = options.serverName ? ` --server ${options.serverName}` : '';
  return {
    server,
    id,
    headers,
    authNote: options.headerFile ? 'the --header-file credentials were rejected' : `run \`replays login${named}\``,
  };
}
