import type { CliDeviceAuthCapability } from '../server/auth/types.ts';
import type { CachedCliToken } from './credentials.ts';

export class CliAuthError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 3) {
    super(message);
    this.exitCode = exitCode;
  }
}

export interface DeviceTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type: string;
}

export interface CliAuthStatus {
  identity: { id: string; email?: string; name?: string };
  expiresAt?: number;
  scopes: string[];
}

const safeEndpoint = (value: string) => {
  const endpoint = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (endpoint.protocol !== 'https:' && !(loopback && endpoint.protocol === 'http:'))
    throw new CliAuthError('server advertises a non-HTTPS authentication endpoint; ask its owner to correct OIDC discovery', 4);
  if (endpoint.username || endpoint.password || endpoint.hash)
    throw new CliAuthError('server advertised an unsafe authentication endpoint', 4);
  return endpoint.href;
};

async function postForm(url: string, form: URLSearchParams, signal?: AbortSignal) {
  try {
    const response = await fetch(safeEndpoint(url), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form,
      redirect: 'error',
      signal: signal ? AbortSignal.any([AbortSignal.timeout(10_000), signal]) : AbortSignal.timeout(10_000),
    });
    const body: unknown = await response.json().catch(() => ({}));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return { ok: response.ok, status: response.status, body: body as Record<string, unknown> };
  } catch (error) {
    if (error instanceof CliAuthError) throw error;
    throw new CliAuthError(
      `could not reach the configured identity provider (${error instanceof Error ? error.message : 'network error'})`,
      4,
    );
  }
}

export async function getCliTokenStatus(server: string, capability: CliDeviceAuthCapability, accessToken: string): Promise<CliAuthStatus> {
  let response: Response;
  try {
    response = await fetch(`${server}/api/cli/auth/status`, {
      headers: { authorization: `Bearer ${accessToken}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new CliAuthError(`could not validate the sign-in with ${server}; check the server connection`, 4);
  }
  if (response.status >= 300 && response.status < 400)
    throw new CliAuthError('server redirected the token validation request; configure the final server URL', 4);
  if (response.status === 401 || response.status === 403)
    throw new CliAuthError(
      'the provider token was rejected: verify the configured OIDC audience, replays:upload scope, and server allowlist',
      4,
    );
  if (!response.ok) throw new CliAuthError(`server token validation failed (${response.status})`, 4);
  const value = (await response.json()) as CliAuthStatus;
  if (!value.identity || !Array.isArray(value.scopes) || !value.scopes.includes('replays:upload'))
    throw new CliAuthError('server did not confirm the replays:upload permission; no credentials were saved', 4);
  if (typeof value.identity.id !== 'string') throw new CliAuthError('server returned an invalid sign-in identity', 4);
  return value;
}

function validateTokenResponse(body: Record<string, unknown>): DeviceTokenResponse {
  if (
    typeof body.access_token !== 'string' ||
    !body.access_token ||
    typeof body.token_type !== 'string' ||
    body.token_type.toLowerCase() !== 'bearer' ||
    typeof body.expires_in !== 'number' ||
    body.expires_in <= 0
  )
    throw new CliAuthError('identity provider returned an incomplete token response', 4);
  if (body.refresh_token !== undefined && (typeof body.refresh_token !== 'string' || !body.refresh_token))
    throw new CliAuthError('identity provider returned an invalid refresh token', 4);
  return body as unknown as DeviceTokenResponse;
}

export async function beginDeviceLogin(server: string, capability: CliDeviceAuthCapability) {
  const request = new URLSearchParams({ client_id: capability.clientId, scope: capability.scopes.join(' ') });
  if (capability.resource) request.set('resource', capability.resource);
  const started = await postForm(capability.deviceAuthorizationEndpoint, request);
  const data = started.body;
  if (!started.ok)
    throw new CliAuthError(
      'identity provider refused the device login request; ask the deployment owner to verify its public-client device grant',
      4,
    );
  const deviceCode = data.device_code;
  const userCode = data.user_code;
  // Print only the base verification URI plus user_code. A provider's "complete" link is
  // unnecessary here and could carry opaque authorization material in its query string.
  const verification = data.verification_uri;
  const expiresIn = data.expires_in;
  const interval = data.interval;
  if (
    typeof deviceCode !== 'string' ||
    !deviceCode ||
    deviceCode.length > 4096 ||
    typeof userCode !== 'string' ||
    !userCode ||
    userCode.length > 64 ||
    typeof verification !== 'string' ||
    verification.length > 2048 ||
    typeof expiresIn !== 'number' ||
    expiresIn <= 0
  )
    throw new CliAuthError('identity provider returned an invalid device authorization response', 4);
  let verificationUrl: URL;
  try {
    verificationUrl = new URL(verification);
  } catch {
    throw new CliAuthError('identity provider returned an invalid approval link', 4);
  }
  if (verificationUrl.username || verificationUrl.password || verificationUrl.hash)
    throw new CliAuthError('identity provider returned an unsafe approval link', 4);
  if (verificationUrl.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(verificationUrl.hostname))
    throw new CliAuthError('identity provider returned a non-HTTPS approval link', 4);

  process.stdout.write(`Approve Replays CLI access for ${server}:\n  ${verificationUrl.href}\n  Code: ${userCode}\n`);
  // Explicit login in CI may print a code, but waits at most 30 seconds; interactive users get up to 15 minutes.
  const maximumWait = process.stdin.isTTY && process.stdout.isTTY ? 15 * 60 : 30;
  const deadline = Date.now() + Math.min(expiresIn, maximumWait) * 1000;
  let pollSeconds = typeof interval === 'number' && interval > 0 ? interval : 5;
  const controller = new AbortController();
  let interrupted = false;
  const onInterrupt = () => {
    interrupted = true;
    controller.abort();
  };
  process.once('SIGINT', onInterrupt);
  const wait = (milliseconds: number) =>
    new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, milliseconds);
      controller.signal.addEventListener('abort', finish, { once: true });
    });
  try {
    while (Date.now() < deadline) {
      await wait(Math.min(pollSeconds * 1000, deadline - Date.now()));
      if (interrupted) throw new CliAuthError('device login interrupted; run `replays login` to try again', 130);
      if (Date.now() >= deadline) break;
      const polled = await postForm(
        capability.tokenEndpoint,
        new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: deviceCode,
          client_id: capability.clientId,
        }),
        controller.signal,
      ).catch((error: unknown) => {
        if (interrupted) throw new CliAuthError('device login interrupted; run `replays login` to try again', 130);
        throw error;
      });
      if (polled.ok) {
        const token = validateTokenResponse(polled.body);
        const status = await getCliTokenStatus(server, capability, token.access_token);
        return { token, status };
      }
      switch (polled.body.error) {
        case 'authorization_pending':
          continue;
        case 'slow_down':
          pollSeconds += 5;
          continue;
        case 'access_denied':
          throw new CliAuthError('sign-in was denied; no upload was attempted', 4);
        case 'expired_token':
          throw new CliAuthError('device approval expired; run `replays login` to request a new code', 4);
        default:
          throw new CliAuthError(
            'identity provider could not complete device sign-in; check the provider setup and try `replays login` again',
            4,
          );
      }
    }
    throw new CliAuthError('device approval timed out; run `replays login` to request a new code', 4);
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    controller.abort();
  }
}

export async function refreshCliToken(server: string, capability: CliDeviceAuthCapability, cached: CachedCliToken) {
  if (!cached.refreshToken) return undefined;
  const result = await postForm(
    capability.tokenEndpoint,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: cached.refreshToken,
      client_id: capability.clientId,
      ...(capability.resource ? { resource: capability.resource } : {}),
    }),
  );
  if (!result.ok) {
    if (result.body.error === 'invalid_grant') return undefined;
    throw new CliAuthError('identity provider could not refresh the CLI session; run `replays login` again', 4);
  }
  const token = validateTokenResponse(result.body);
  const status = await getCliTokenStatus(server, capability, token.access_token);
  return {
    token: {
      ...cached,
      accessToken: token.access_token,
      ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
      expiresAt: status.expiresAt ?? Math.floor(Date.now() / 1000 + token.expires_in),
    } satisfies CachedCliToken,
    status,
  };
}

export async function revokeCliToken(capability: CliDeviceAuthCapability, token: CachedCliToken) {
  if (!capability.revocationEndpoint) return false;
  let failed = false;
  for (const [value, hint] of [
    [token.refreshToken, 'refresh_token'],
    [token.accessToken, 'access_token'],
  ] as const) {
    if (!value) continue;
    try {
      const result = await postForm(
        capability.revocationEndpoint,
        new URLSearchParams({ token: value, token_type_hint: hint, client_id: capability.clientId }),
      );
      if (!result.ok) failed = true;
    } catch {
      failed = true;
    }
  }
  return !failed;
}

export async function fetchCliAuthCapability(server: string) {
  let response: Response;
  try {
    response = await fetch(`${server}/api/cli/auth/capabilities`, { redirect: 'manual', signal: AbortSignal.timeout(8_000) });
  } catch {
    throw new CliAuthError(`could not reach configured server ${server}; check the URL and network`, 4);
  }
  if (response.status >= 300 && response.status < 400)
    throw new CliAuthError('server redirected the authentication capability request; configure the final server URL', 4);
  if (!response.ok) throw new CliAuthError(`server authentication capability check failed (${response.status})`, 4);
  const value = (await response.json()) as { auth?: string; deviceFlow?: CliDeviceAuthCapability | null };
  const capability = value.deviceFlow ?? undefined;
  if (capability) {
    if (
      capability.type !== 'oidc-device' ||
      typeof capability.issuer !== 'string' ||
      typeof capability.clientId !== 'string' ||
      typeof capability.audience !== 'string' ||
      typeof capability.resource !== 'string' ||
      capability.audience !== capability.resource ||
      !Array.isArray(capability.scopes) ||
      capability.scopes.join(' ') !== 'openid email profile replays:upload'
    )
      throw new CliAuthError('server advertised an invalid OIDC device-flow capability', 4);
    const discoveryUrl = safeEndpoint(`${capability.issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`);
    let metadataResponse: Response;
    try {
      metadataResponse = await fetch(discoveryUrl, { redirect: 'error', signal: AbortSignal.timeout(8_000) });
    } catch {
      throw new CliAuthError('could not verify the provider metadata advertised by this server', 4);
    }
    if (!metadataResponse.ok) throw new CliAuthError(`provider metadata verification failed (${metadataResponse.status})`, 4);
    const metadata = (await metadataResponse.json()) as {
      issuer?: string;
      token_endpoint?: string;
      device_authorization_endpoint?: string;
      revocation_endpoint?: string;
    };
    const matches = (advertised: string | undefined, discovered: string | undefined) => {
      if (!advertised || !discovered) return advertised === discovered;
      return safeEndpoint(advertised) === safeEndpoint(discovered);
    };
    if (
      typeof metadata.issuer !== 'string' ||
      metadata.issuer.replace(/\/+$/, '') !== capability.issuer.replace(/\/+$/, '') ||
      !matches(capability.tokenEndpoint, metadata.token_endpoint) ||
      !matches(capability.deviceAuthorizationEndpoint, metadata.device_authorization_endpoint) ||
      !matches(capability.revocationEndpoint, metadata.revocation_endpoint)
    )
      throw new CliAuthError('server authentication endpoints do not match the configured OIDC issuer metadata', 4);
  }
  return { auth: value.auth ?? 'unknown', deviceFlow: capability };
}

export function tokenFromResponse(
  server: string,
  capability: CliDeviceAuthCapability,
  token: DeviceTokenResponse,
  status?: CliAuthStatus,
): CachedCliToken {
  return {
    version: 1,
    server,
    issuer: capability.issuer,
    clientId: capability.clientId,
    accessToken: token.access_token,
    ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
    expiresAt: status?.expiresAt ?? Math.floor(Date.now() / 1000 + token.expires_in),
  };
}
