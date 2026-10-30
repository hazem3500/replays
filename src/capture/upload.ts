import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { assertReplayBundle, withMetaProfile } from '../shared/replay.ts';
import { flagMap, profileFlag, UploadHttpError, upload } from './bundle-io.ts';
import {
  CliAuthError,
  beginDeviceLogin,
  fetchCliAuthCapability,
  getCliTokenStatus,
  refreshCliToken,
  revokeCliToken,
  tokenFromResponse,
  type CliAuthStatus,
} from './device-auth.ts';
import { deleteCliToken, loadCliToken, saveCliToken } from './credentials.ts';
import { readCliConfig, resetCliConfig, resolveServerUrl, resolveUploadEndpoint, saveServer, uploadEndpoint } from './server-config.ts';

const LOGIN_REQUIRED_EXIT_CODE = 3;
const isInteractive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

function reportFailure(error: unknown) {
  process.stderr.write(`${JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = error instanceof CliAuthError ? error.exitCode : 1;
}

function identityLabel(status: CliAuthStatus) {
  return status.identity.email || status.identity.name || status.identity.id;
}

async function refreshIfNeeded(
  server: string,
  capability: NonNullable<Awaited<ReturnType<typeof fetchCliAuthCapability>>['deviceFlow']>,
  cached: Awaited<ReturnType<typeof loadCliToken>>,
) {
  if (!cached) return undefined;
  if (cached.expiresAt > Math.floor(Date.now() / 1000) + 30) return { cached };
  const refreshed = await refreshCliToken(server, capability, cached);
  if (refreshed) {
    await saveCliToken(refreshed.token);
    return { cached: refreshed.token, status: refreshed.status };
  }
  // A different CLI process may have rotated this single-use refresh token.
  // Failed refreshes must not delete credentials saved by that process.
  const latest = await loadCliToken(server, capability.issuer, capability.clientId);
  if (latest && (latest.accessToken !== cached.accessToken || latest.refreshToken !== cached.refreshToken)) return { cached: latest };
  return undefined;
}

export async function uploadWithCliAuth(
  bundle: Parameters<typeof upload>[0],
  output: string,
  endpoint: string,
  options: { headerFile?: string; forceLogin?: boolean; serverName?: string } = {},
) {
  if (options.headerFile) {
    if (options.forceLogin)
      throw new CliAuthError('--header-file uses the explicit host credentials and cannot be combined with --login', 2);
    await upload(bundle, output, endpoint, options.headerFile);
    return;
  }
  // A saved credential is considered only for the exact canonical endpoint derived from its saved server base.
  // An arbitrary --upload-url or a wrapper-approved endpoint that differs from that target never receives a token.
  let savedServer: string | undefined;
  try {
    const server = await resolveServerUrl(options.serverName ? { explicitName: options.serverName } : {});
    if (endpoint === uploadEndpoint(server.url)) savedServer = server.url;
  } catch {
    // Explicit standalone upload URLs remain unauthenticated unless they match a saved named/default server.
  }
  if (!savedServer) {
    if (options.forceLogin) throw new CliAuthError('login requires a configured server; run `replays connect <server-url>` first', 2);
    await upload(bundle, output, endpoint);
    return;
  }
  let auth: Awaited<ReturnType<typeof fetchCliAuthCapability>>;
  try {
    auth = await fetchCliAuthCapability(savedServer);
  } catch (error) {
    if (!(error instanceof CliAuthError) || !/\((404|401|403)\)/.test(error.message)) throw error;
    try {
      await upload(bundle, output, endpoint);
    } catch (uploadError) {
      if (uploadError instanceof UploadHttpError && (uploadError.status === 401 || uploadError.status === 403))
        throw new Error(
          `replay upload was refused (${uploadError.status}); the server does not advertise CLI device login. Use its host-auth headers with --header-file or ask the deployment owner to enable a supported provider integration.`,
          { cause: uploadError },
        );
      throw uploadError;
    }
    return;
  }
  if (auth.auth === 'none') {
    await upload(bundle, output, endpoint);
    return;
  }
  if (!auth.deviceFlow) {
    if (options.forceLogin)
      throw new CliAuthError(
        `this server uses ${auth.auth} authentication but does not advertise CLI device login; ask its owner to enable a supported provider integration or use --header-file`,
        4,
      );
    try {
      await upload(bundle, output, endpoint);
    } catch (error) {
      if (error instanceof UploadHttpError && (error.status === 401 || error.status === 403))
        throw new Error(
          `replay upload was refused (${error.status}); this server does not advertise CLI device login. Use its host-auth headers with --header-file or ask the deployment owner to enable a supported provider integration.`,
          { cause: error },
        );
      throw error;
    }
    return;
  }
  let cached = await loadCliToken(savedServer, auth.deviceFlow.issuer, auth.deviceFlow.clientId);
  const available = await refreshIfNeeded(savedServer, auth.deviceFlow, cached);
  if (available) cached = available.cached;
  else cached = undefined;
  if (!cached || options.forceLogin) {
    if (!options.forceLogin && !isInteractive())
      throw new CliAuthError(
        `sign in is required for ${savedServer}; run \`replays login${options.serverName ? ` --server ${options.serverName}` : ''}\` in an interactive terminal`,
        LOGIN_REQUIRED_EXIT_CODE,
      );
    const authorized = await beginDeviceLogin(savedServer, auth.deviceFlow);
    cached = tokenFromResponse(savedServer, auth.deviceFlow, authorized.token, authorized.status);
    await saveCliToken(cached);
    process.stdout.write(`Signed in to ${savedServer} as ${identityLabel(authorized.status)}.\n`);
  }
  try {
    await upload(bundle, output, endpoint, undefined, cached.accessToken);
  } catch (error) {
    if (error instanceof UploadHttpError && error.status === 401) {
      // Keep failures non-destructive: this request may have used an older
      // token than a concurrent login or refresh has already saved.
      if (options.forceLogin || isInteractive()) {
        const authorized = await beginDeviceLogin(savedServer, auth.deviceFlow);
        const refreshed = tokenFromResponse(savedServer, auth.deviceFlow, authorized.token, authorized.status);
        await saveCliToken(refreshed);
        await upload(bundle, output, endpoint, undefined, refreshed.accessToken);
        return;
      }
      throw new CliAuthError(
        `the saved session for ${savedServer} was revoked; run \`replays login${options.serverName ? ` --server ${options.serverName}` : ''}\``,
        LOGIN_REQUIRED_EXIT_CODE,
      );
    }
    if (error instanceof UploadHttpError && error.status === 403)
      throw new CliAuthError(
        `server refused ${error.video ? 'video upload' : 'replay upload'} (403); verify the signed-in account is allowed and its grant includes replays:upload${error.video ? '. The replay may already be saved' : ''}.`,
        4,
      );
    throw error;
  }
}

export async function uploadConfigured(
  bundle: Parameters<typeof upload>[0],
  output: string,
  options: { uploadUrl?: string; serverName?: string; headerFile?: string; forceLogin?: boolean } = {},
) {
  const endpoint = await resolveUploadEndpoint({
    ...(options.uploadUrl ? { explicitUploadUrl: options.uploadUrl } : {}),
    ...(options.serverName ? { explicitServerName: options.serverName } : {}),
  });
  await uploadWithCliAuth(bundle, output, endpoint, options);
}

/** `replays upload <replay.json> [--upload-url <endpoint> | --server <name>] [--login] [--header-file file] [--profile id]` */
export async function runUploadCli(argv: string[]) {
  try {
    const [file, ...flags] = argv;
    if (!file || file.startsWith('--'))
      throw new Error(
        'usage: replays upload <replay.json> [--upload-url <endpoint> | --server <name>] [--login] [--header-file file] [--profile id]',
      );
    const { values, booleans } = flagMap(flags, new Set(['login']));
    if ([...booleans].some((key) => key !== 'login')) throw new Error('unknown upload option');
    const target = await resolveUploadEndpoint({
      ...(values['upload-url'] ? { explicitUploadUrl: values['upload-url'] } : {}),
      ...(values.server ? { explicitServerName: values.server } : {}),
    });
    const bundle: unknown = JSON.parse(await readFile(resolve(file), 'utf8'));
    assertReplayBundle(bundle);
    // why: --profile sets (or replaces) the profile; the server checks it against its profiles.
    const profile = profileFlag(values);
    if (profile !== undefined) bundle.meta = withMetaProfile(bundle.meta, profile);
    await uploadWithCliAuth(bundle, dirname(resolve(file)), target, {
      ...(values['header-file'] ? { headerFile: values['header-file'] } : {}),
      ...(booleans.has('login') ? { forceLogin: true } : {}),
      ...(values.server ? { serverName: values.server } : {}),
    });
    process.stdout.write(`${JSON.stringify({ success: true, id: bundle.meta.id })}\n`);
  } catch (error) {
    reportFailure(error);
  }
}

async function selectedServer(argv: string[], command: string) {
  const { values } = flagMap(argv);
  if (Object.keys(values).some((key) => key !== 'server')) throw new Error(`usage: replays ${command} [--server <name>]`);
  return resolveServerUrl(values.server ? { explicitName: values.server } : {});
}

/** `replays login [--server <name>]`; explicitly starts provider-owned device approval. */
export async function runLoginCli(argv: string[]) {
  try {
    const target = await selectedServer(argv, 'login');
    const auth = await fetchCliAuthCapability(target.url);
    if (auth.auth === 'none') {
      process.stdout.write(`No sign-in is required for ${target.url}.\n`);
      return;
    }
    if (!auth.deviceFlow)
      throw new CliAuthError(
        `this server uses ${auth.auth} authentication but does not advertise CLI device login. Use its supported host credentials with --header-file or ask the deployment owner to enable an approved provider integration.`,
        4,
      );
    const capability = auth.deviceFlow;
    const cached = await loadCliToken(target.url, capability.issuer, capability.clientId);
    if (cached && cached.expiresAt > Math.floor(Date.now() / 1000) + 30) {
      try {
        const status = await getCliTokenStatus(target.url, capability, cached.accessToken);
        process.stdout.write(
          `Already signed in to ${target.url} as ${identityLabel(status)} (expires ${status.expiresAt ? new Date(status.expiresAt * 1000).toISOString() : new Date(cached.expiresAt * 1000).toISOString()}).\n`,
        );
        return;
      } catch {
        // This process may have checked an older access token while another CLI replaced it.
        // Keep the saved session until explicit logout or a successful replacement.
      }
    }
    const existing = await loadCliToken(target.url, capability.issuer, capability.clientId);
    if (existing?.refreshToken) {
      const refreshed = await refreshCliToken(target.url, capability, existing).catch(() => undefined);
      if (refreshed) {
        await saveCliToken(refreshed.token);
        process.stdout.write(
          `Signed in to ${target.url} as ${identityLabel(refreshed.status)} (expires ${new Date(refreshed.token.expiresAt * 1000).toISOString()}).\n`,
        );
        return;
      }
      const latest = await loadCliToken(target.url, capability.issuer, capability.clientId);
      if (latest && (latest.accessToken !== existing.accessToken || latest.refreshToken !== existing.refreshToken)) {
        try {
          const status = await getCliTokenStatus(target.url, capability, latest.accessToken);
          process.stdout.write(
            `Already signed in to ${target.url} as ${identityLabel(status)} (expires ${status.expiresAt ? new Date(status.expiresAt * 1000).toISOString() : new Date(latest.expiresAt * 1000).toISOString()}).\n`,
          );
          return;
        } catch {
          // A failed validation must not remove a credential another process just saved.
        }
      }
    }
    const result = await beginDeviceLogin(target.url, capability);
    const token = tokenFromResponse(target.url, capability, result.token, result.status);
    await saveCliToken(token);
    process.stdout.write(
      `Signed in to ${target.url} as ${identityLabel(result.status)} (expires ${new Date(token.expiresAt * 1000).toISOString()}).\n`,
    );
  } catch (error) {
    reportFailure(error);
  }
}

/** `replays status [--server <name>]`; reports only server, identity, scopes and expiry. */
export async function runStatusCli(argv: string[]) {
  try {
    const target = await selectedServer(argv, 'status');
    const auth = await fetchCliAuthCapability(target.url);
    if (auth.auth === 'none') {
      process.stdout.write(`Connected to ${target.url}; sign-in is not required.\n`);
      return;
    }
    if (!auth.deviceFlow) {
      process.stdout.write(
        `Connected to ${target.url}; ${auth.auth} authentication is managed by the host. CLI sign-in is not available.\n`,
      );
      return;
    }
    const capability = auth.deviceFlow;
    const cached = await loadCliToken(target.url, capability.issuer, capability.clientId);
    if (!cached) {
      process.stdout.write(`Not signed in to ${target.url}. Run \`replays login${target.name ? ` --server ${target.name}` : ''}\`.\n`);
      return;
    }
    const refreshed = await refreshIfNeeded(target.url, capability, cached);
    if (!refreshed) {
      process.stdout.write(`Session expired for ${target.url}. Run \`replays login${target.name ? ` --server ${target.name}` : ''}\`.\n`);
      return;
    }
    let status: CliAuthStatus;
    try {
      status = refreshed.status ?? (await getCliTokenStatus(target.url, capability, refreshed.cached.accessToken));
    } catch (error) {
      if (error instanceof CliAuthError && error.message.startsWith('the provider token was rejected')) {
        process.stdout.write(
          `The saved session for ${target.url} is no longer accepted. Run \`replays login${target.name ? ` --server ${target.name}` : ''}\`.\n`,
        );
        return;
      }
      throw error;
    }
    process.stdout.write(
      `Signed in to ${target.url} as ${identityLabel(status)} (upload only; expires ${new Date(status.expiresAt ? status.expiresAt * 1000 : refreshed.cached.expiresAt * 1000).toISOString()}).\n`,
    );
  } catch (error) {
    reportFailure(error);
  }
}

/** `replays logout [--server <name>]`; local credentials are always removed, provider revocation is attempted when advertised. */
export async function runLogoutCli(argv: string[]) {
  try {
    const target = await selectedServer(argv, 'logout');
    const auth = await fetchCliAuthCapability(target.url);
    if (!auth.deviceFlow) {
      process.stdout.write(`No CLI device session is configured for ${target.url}; host-managed credentials were not changed.\n`);
      return;
    }
    const capability = auth.deviceFlow;
    const cached = await loadCliToken(target.url, capability.issuer, capability.clientId);
    if (!cached) {
      process.stdout.write(`No CLI session was saved for ${target.url}.\n`);
      return;
    }
    const revoked = await revokeCliToken(capability, cached);
    await deleteCliToken(target.url, capability.issuer, capability.clientId);
    process.stdout.write(
      revoked
        ? `Signed out from ${target.url}; provider revocation completed.\n`
        : `Signed out from ${target.url} locally; provider revocation was unavailable or failed.\n`,
    );
  } catch (error) {
    reportFailure(error);
  }
}

/** `replays connect <server-url> [--name <name>]` stores a non-secret server address as the default. */
export async function runConnectCli(argv: string[]) {
  try {
    const [url, ...flags] = argv;
    if (!url || url.startsWith('--')) throw new Error('usage: replays connect <server-url> [--name <name>]');
    const { values } = flagMap(flags);
    if (Object.keys(values).some((key) => key !== 'name')) throw new Error('only --name is supported');
    const config = await saveServer(url, values.name);
    const name = values.name || 'default';
    process.stdout.write(
      `${JSON.stringify({ success: true, name, server: config.servers[name]!.url, default: true, config: 'saved (no credentials stored)' })}\n`,
    );
  } catch (error) {
    reportFailure(error);
  }
}

/** Lists saved server names without printing secrets; `replays config reset` removes the local config. */
export async function runConfigCli(argv: string[]) {
  try {
    if (argv.length === 1 && argv[0] === 'reset') {
      await resetCliConfig();
      process.stdout.write(`${JSON.stringify({ success: true, reset: true })}\n`);
      return;
    }
    if (argv.length) throw new Error('usage: replays config [reset]');
    const config = await readCliConfig();
    process.stdout.write(
      `${JSON.stringify({ success: true, defaultServer: config.defaultServer, servers: Object.entries(config.servers).map(([name, server]) => ({ name, url: server.url })) })}\n`,
    );
  } catch (error) {
    reportFailure(error);
  }
}

/** A read-only reachability check; it does not authenticate a user or prove upload permission. */
export async function runDoctorCli(argv: string[]) {
  try {
    const { values } = flagMap(argv);
    if (Object.keys(values).some((key) => key !== 'server')) throw new Error('usage: replays doctor [--server <name>]');
    const target = await resolveServerUrl(values.server ? { explicitName: values.server } : {});
    let response: Response;
    try {
      response = await fetch(`${target.url}/api/cli/auth/capabilities`, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
      if (response.status === 404)
        response = await fetch(`${target.url}/api/config`, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
    } catch {
      throw new Error(`could not reach configured server ${target.url}; check the URL and network`);
    }
    if (response.status >= 300 && response.status < 400)
      throw new Error('server check was redirected; configure the final server URL directly');
    const authRequired = response.status === 401 || response.status === 403;
    if (authRequired) {
      process.stdout.write(
        `${JSON.stringify({ success: true, reachable: true, server: target.url, uploadEndpoint: uploadEndpoint(target.url), auth: 'host-managed', cliDeviceLogin: 'not advertised', note: 'Reachability only; this check does not create an upload session.' })}\n`,
      );
      return;
    }
    if (!response.ok) throw new Error(`server responded with ${response.status} at ${target.url}; check that this is the viewer base URL`);
    const config = (await response.json().catch(() => ({}))) as {
      cliDeviceAuth?: { type?: string };
      deviceFlow?: { type?: string } | null;
      auth?: string;
    };
    process.stdout.write(
      `${JSON.stringify({
        success: true,
        reachable: true,
        server: target.url,
        uploadEndpoint: uploadEndpoint(target.url),
        auth: config.auth ?? 'unknown',
        cliDeviceLogin: (config.cliDeviceAuth?.type ?? config.deviceFlow?.type) === 'oidc-device' ? 'available' : 'not advertised',
        note: 'Reachability only; uploads may still require a signed-in identity and upload permission.',
      })}\n`,
    );
  } catch (error) {
    reportFailure(error);
  }
}
