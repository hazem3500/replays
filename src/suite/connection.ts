import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ReviewSuiteAdapter } from '../capture/review-suite.ts';
import { CliAuthError, fetchCliAuthCapability } from '../capture/device-auth.ts';
import { loadCliToken } from '../capture/credentials.ts';
import { resolveServerUrl, resolveUploadEndpoint, uploadEndpoint } from '../capture/server-config.ts';
import { refreshIfNeeded } from '../capture/upload.ts';

export interface ConnectionFlags {
  'upload-url'?: string;
  server?: string;
  'header-file'?: string;
}

export interface SuiteConnection {
  /** The server's base URL, without a trailing slash; links are `<server>/s/<suite>`. */
  server: string;
  api: ReviewSuiteAdapter;
}

const API_SUFFIX = '/api/replays';

async function headerFile(file: string): Promise<Record<string, string>> {
  const parsed: unknown = JSON.parse(await readFile(resolve(file), 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== 'string'))
    throw new Error('--header-file must contain a JSON object with string header values');
  return parsed as Record<string, string>;
}

/** A saved sign-in is only sent to the server it was saved for: the one `--server` or the default names, never an arbitrary URL. */
async function savedSignIn(server: string, flags: ConnectionFlags): Promise<Record<string, string>> {
  let saved: string | undefined;
  try {
    const target = await resolveServerUrl(flags.server ? { explicitName: flags.server } : {});
    if (uploadEndpoint(target.url) === `${server}${API_SUFFIX}`) saved = target.url;
  } catch {
    return {};
  }
  if (!saved) return {};
  let auth: Awaited<ReturnType<typeof fetchCliAuthCapability>>;
  try {
    auth = await fetchCliAuthCapability(saved);
  } catch (error) {
    if (error instanceof CliAuthError && /\((404|401|403)\)/.test(error.message)) return {};
    throw error;
  }
  if (auth.auth === 'none' || !auth.deviceFlow) return {};
  const available = await refreshIfNeeded(
    saved,
    auth.deviceFlow,
    await loadCliToken(saved, auth.deviceFlow.issuer, auth.deviceFlow.clientId),
  );
  if (!available)
    throw new CliAuthError(
      `sign in is required for ${saved}; run \`replays login${flags.server ? ` --server ${flags.server}` : ''}\` in an interactive terminal`,
      3,
    );
  return { authorization: `Bearer ${available.cached.accessToken}` };
}

/** The server, headers and API client for a suite command, from the same flags and sign-in the upload commands use. */
export async function connect(flags: ConnectionFlags): Promise<SuiteConnection> {
  const endpoint = await resolveUploadEndpoint({
    ...(flags['upload-url'] ? { explicitUploadUrl: flags['upload-url'] } : {}),
    ...(flags.server ? { explicitServerName: flags.server } : {}),
  });
  const server = endpoint.endsWith(API_SUFFIX) ? endpoint.slice(0, -API_SUFFIX.length) : new URL(endpoint).origin;
  const headers = flags['header-file'] ? await headerFile(flags['header-file']) : await savedSignIn(server, flags);
  return { server, api: new ReviewSuiteAdapter(`${server}/api`, headers) };
}

export const suiteUrl = (server: string, suiteId: string) => `${server}/s/${encodeURIComponent(suiteId)}`;
export const replayUrl = (server: string, suiteId: string, replayId: string) =>
  `${server}/s/${encodeURIComponent(suiteId)}/r/${encodeURIComponent(replayId)}`;
