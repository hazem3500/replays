import { CliAuthError, fetchCliAuthCapability, getCliTokenStatus, type CliAuthStatus } from './device-auth.ts';
import { loadCliToken } from './credentials.ts';
import { createTerminal } from './terminal.ts';
import { identityLabel, refreshIfNeeded, reportFailure, selectedServer } from './upload.ts';

type StatusState = 'open' | 'host-managed' | 'signed-out' | 'expired' | 'rejected' | 'signed-in';

interface StatusReport {
  state: StatusState;
  server: string;
  message: string;
  identity?: string;
  expiresAt?: string;
  hint?: string;
}

const STATE_LABELS: Record<StatusState, string> = {
  open: 'No sign-in required',
  'host-managed': 'Managed by the host',
  'signed-out': 'Not signed in',
  expired: 'Session expired',
  rejected: 'Session no longer accepted',
  'signed-in': 'Signed in (upload only)',
};

type Row = [string, string];

function printStatus(report: StatusReport, json: boolean, env: NodeJS.ProcessEnv) {
  const out = createTerminal({ env, stream: process.stdout, json });
  if (json) {
    process.stdout.write(`${JSON.stringify({ success: true, ...report })}\n`);
    return;
  }
  if (!out.fancy) {
    process.stdout.write(`${report.message}\n`);
    return;
  }
  const good = report.state === 'signed-in' || report.state === 'open';
  const label = STATE_LABELS[report.state];
  const rows: Row[] = [
    ['Server', report.server],
    ...(report.identity ? [['Account', report.identity] satisfies Row] : []),
    ['State', good ? out.ok(label) : out.warn(label)],
    ...(report.expiresAt ? [['Expires', report.expiresAt] satisfies Row] : []),
  ];
  process.stdout.write(`${out.header()}\n\n${out.keyValue(rows)}\n${report.hint ? `\n  ${out.dim(`→ ${report.hint}`)}\n` : ''}`);
}

function needsLogin(state: 'signed-out' | 'expired' | 'rejected', server: string, loginCommand: string): StatusReport {
  const messages = {
    'signed-out': `Not signed in to ${server}. Run \`${loginCommand}\`.`,
    expired: `Session expired for ${server}. Run \`${loginCommand}\`.`,
    rejected: `The saved session for ${server} is no longer accepted. Run \`${loginCommand}\`.`,
  };
  return { state, server, message: messages[state], hint: `Run \`${loginCommand}\`` };
}

async function statusOf(server: string, loginCommand: string): Promise<StatusReport> {
  const auth = await fetchCliAuthCapability(server);
  if (auth.auth === 'none') return { state: 'open', server, message: `Connected to ${server}; sign-in is not required.` };
  if (!auth.deviceFlow)
    return {
      state: 'host-managed',
      server,
      message: `Connected to ${server}; ${auth.auth} authentication is managed by the host. CLI sign-in is not available.`,
    };
  const capability = auth.deviceFlow;
  const cached = await loadCliToken(server, capability.issuer, capability.clientId);
  if (!cached) return needsLogin('signed-out', server, loginCommand);
  const refreshed = await refreshIfNeeded(server, capability, cached);
  if (!refreshed) return needsLogin('expired', server, loginCommand);
  let status: CliAuthStatus;
  try {
    status = refreshed.status ?? (await getCliTokenStatus(server, capability, refreshed.cached.accessToken));
  } catch (error) {
    if (error instanceof CliAuthError && error.message.startsWith('the provider token was rejected'))
      return needsLogin('rejected', server, loginCommand);
    throw error;
  }
  const expiresAt = new Date(status.expiresAt ? status.expiresAt * 1000 : refreshed.cached.expiresAt * 1000).toISOString();
  return {
    state: 'signed-in',
    server,
    identity: identityLabel(status),
    expiresAt,
    message: `Signed in to ${server} as ${identityLabel(status)} (upload only; expires ${expiresAt}).`,
  };
}

/** `replays status [--server <name>] [--json]`; reports only server, identity, scopes and expiry. */
export async function runStatusCli(argv: string[], env: NodeJS.ProcessEnv = {}) {
  const json = argv.includes('--json');
  try {
    const target = await selectedServer(argv, 'status', true);
    const loginCommand = `replays login${target.name ? ` --server ${target.name}` : ''}`;
    printStatus(await statusOf(target.url, loginCommand), json, env);
  } catch (error) {
    reportFailure(error, json, env);
  }
}
