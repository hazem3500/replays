import { fetchCliAuthCapability } from './device-auth.ts';
import { loadCliToken } from './credentials.ts';
import { doctorOutcome, localChecks, type DoctorCheck } from './doctor.ts';
import { flagMap } from './bundle-io.ts';
import { resolveServerUrl, uploadEndpoint } from './server-config.ts';
import { createTerminal } from './terminal.ts';
import { reportFailure } from './upload.ts';

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;

async function probeServer(url: string) {
  let response: Response;
  try {
    response = await fetch(`${url}/api/cli/auth/capabilities`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 404)
      response = await fetch(`${url}/api/config`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });
  } catch {
    throw new Error(`could not reach configured server ${url}; check the URL and network`);
  }
  if (response.status >= 300 && response.status < 400)
    throw new Error('server check was redirected; configure the final server URL directly');
  if (response.status === 401 || response.status === 403)
    return {
      reachable: true,
      server: url,
      uploadEndpoint: uploadEndpoint(url),
      auth: 'host-managed',
      cliDeviceLogin: 'not advertised',
      note: 'Reachability only; this check does not create an upload session.',
    };
  if (!response.ok) throw new Error(`server responded with ${response.status} at ${url}; check that this is the viewer base URL`);
  const body: unknown = await response.json().catch(() => ({}));
  const deviceType = field(field(body, 'cliDeviceAuth'), 'type') ?? field(field(body, 'deviceFlow'), 'type');
  return {
    reachable: true,
    server: url,
    uploadEndpoint: uploadEndpoint(url),
    auth: typeof field(body, 'auth') === 'string' ? String(field(body, 'auth')) : 'unknown',
    cliDeviceLogin: deviceType === 'oidc-device' ? 'available' : 'not advertised',
    note: 'Reachability only; uploads may still require a signed-in identity and upload permission.',
  };
}

async function signInCheck(url: string, serverName?: string): Promise<DoctorCheck> {
  try {
    const auth = await fetchCliAuthCapability(url);
    if (auth.auth === 'none') return { id: 'sign-in', status: 'ok', detail: 'not required' };
    if (!auth.deviceFlow)
      return {
        id: 'sign-in',
        status: 'ok',
        detail: `${auth.auth} authentication is managed by the host`,
      };
    const saved = await loadCliToken(url, auth.deviceFlow.issuer, auth.deviceFlow.clientId);
    if (saved) return { id: 'sign-in', status: 'ok', detail: 'saved session found' };
    return {
      id: 'sign-in',
      status: 'warn',
      detail: 'not signed in',
      fix: `Run \`replays login${serverName ? ` --server ${serverName}` : ''}\`.`,
    };
  } catch {
    return {
      id: 'sign-in',
      status: 'warn',
      detail: 'could not be checked',
      fix: 'Run `replays status` for details.',
    };
  }
}

const CHECK_LABELS: Record<DoctorCheck['id'], string> = {
  node: 'Node',
  chrome: 'Chrome',
  ffmpeg: 'ffmpeg',
  server: 'Server',
  'sign-in': 'Sign-in',
};

const CHECK_MARKS = { ok: 'ok', warn: 'warn', fail: 'failed' } as const;

async function serverChecks(name: string | undefined) {
  try {
    const target = await resolveServerUrl(name ? { explicitName: name } : {});
    const server = await probeServer(target.url);
    return {
      server,
      checks: [
        {
          id: 'server',
          status: 'ok',
          detail: target.url,
        } satisfies DoctorCheck,
        await signInCheck(target.url, target.name),
      ],
    };
  } catch (error) {
    return {
      server: undefined,
      checks: [
        {
          id: 'server',
          status: 'fail',
          detail: error instanceof Error ? error.message : String(error),
        } satisfies DoctorCheck,
      ],
    };
  }
}

function printDoctor(checks: readonly DoctorCheck[], server: object | undefined, json: boolean, env: NodeJS.ProcessEnv) {
  const out = createTerminal({ env, stream: process.stdout, json });
  const failed = doctorOutcome(checks) === 'fail';
  if (out.fancy) {
    const rows = checks.map((check): [string, string] => [CHECK_LABELS[check.id], out[CHECK_MARKS[check.status]](check.detail)]);
    const fixes = checks.filter((check) => check.fix).map((check) => `  ${out.dim(`→ ${CHECK_LABELS[check.id]}: ${check.fix}`)}`);
    process.stdout.write(`${out.header()}\n\n${out.keyValue(rows)}\n${fixes.length ? `\n${fixes.join('\n')}\n` : ''}`);
  } else if (failed)
    process.stderr.write(`${JSON.stringify({ success: false, error: checks.find((check) => check.status === 'fail')?.detail, checks })}\n`);
  else process.stdout.write(`${JSON.stringify({ success: true, ...server, checks })}\n`);
}

/** Checks Node, Chrome, ffmpeg, the configured server and the saved sign-in. Reachability does not authenticate a user or prove upload permission. */
export async function runDoctorCli(argv: string[], env: NodeJS.ProcessEnv = {}) {
  const json = argv.includes('--json');
  try {
    const { values } = flagMap(argv, new Set(['json']));
    if (Object.keys(values).some((key) => key !== 'server')) throw new Error('usage: replays doctor [--server <name>] [--json]');
    const remote = await serverChecks(values.server);
    const checks = [...localChecks(env), ...remote.checks];
    if (doctorOutcome(checks) === 'fail') process.exitCode = 1;
    printDoctor(checks, remote.server, json, env);
  } catch (error) {
    reportFailure(error, json, env);
  }
}
