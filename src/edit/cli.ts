import { createTerminal } from '../capture/terminal.ts';
import { reportFailure } from '../capture/upload.ts';
import { bundleSpan } from '../shared/edits.ts';
import type { ReplayBundle } from '../shared/replay.ts';
import { type ParsedArgs, parseArgs } from './args.ts';
import { resolveTarget, type TargetOptions } from './auth.ts';
import { EditClient } from './client.ts';
import { EditError, usageError } from './errors.ts';
import { cursor, cut, rename, region, speed, trim, zoom } from './edit-commands.ts';
import { exportVideo } from './export-command.ts';
import { pull, push, show } from './read-commands.ts';
import { type EditOutput, only, type Session } from './session.ts';
import { caption, highlight } from './text-commands.ts';

export type { EditOutput } from './session.ts';

export interface EditCliOptions {
  /** The one server a credential-attaching wrapper approves; other servers are refused. */
  trustedServerUrl?: string;
  /** Replaces `fetch`, for tests. */
  fetch?: typeof fetch;
  /** The CLI config file to read the saved server from; the platform default when absent. */
  configPath?: string;
  stderr?: Pick<NodeJS.WriteStream, 'write' | 'isTTY'>;
}

const VALUE_FLAGS = [
  'server',
  'header-file',
  'from',
  'to',
  'at',
  'rate',
  'rect',
  'scale',
  'min',
  'label',
  'speed',
  'output',
  'timeout',
  'size',
  'motion',
  'appearance',
  'color',
  'click-effect',
  'visible',
  'hide-when-idle',
  'click-feedback',
  'selector',
];

const BOOLEAN_FLAGS = ['json', 'force', 'dry-run', 'reset', 'captions', 'full', 'help'];

type Handler = (session: Session, args: ParsedArgs) => Promise<EditOutput>;

const HANDLERS: Record<string, Handler> = {
  show: (session, args) => {
    only(args, [], 'show');
    return show(session);
  },
  pull,
  push,
  rename,
  cut,
  speed,
  zoom,
  blur: (session, args) => region(session, args, 'blur'),
  remove: (session, args) => region(session, args, 'remove'),
  caption,
  highlight,
  trim,
  cursor,
  export: exportVideo,
};

const undoError = () =>
  new EditError(
    'undo is not available: the server keeps only the current edit list, not a history. Before a big change run `replays edit <id> pull -o backup.json`; `push backup.json` goes back to it. Or remove one item (for example `cut rm 2`)',
  );

async function createSession(target: string, args: ParsedArgs, env: NodeJS.ProcessEnv, options: EditCliOptions): Promise<Session> {
  const json = args.booleans.has('json');
  const targetOptions: TargetOptions = {
    env,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) && !json,
    ...(args.values.server ? { serverName: args.values.server } : {}),
    ...(args.values['header-file'] ? { headerFile: args.values['header-file'] } : {}),
    ...(options.trustedServerUrl ? { trustedServerUrl: options.trustedServerUrl } : {}),
    ...(options.configPath ? { configPath: options.configPath } : {}),
  };
  const resolved = await resolveTarget(target, targetOptions);
  const client = new EditClient({
    server: resolved.server,
    id: resolved.id,
    headers: resolved.headers,
    authNote: resolved.authNote,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  let bundle: Promise<ReplayBundle> | undefined;
  const session: Session = {
    client,
    json,
    env,
    stderr: options.stderr ?? process.stderr,
    bundle: () => (bundle ??= client.bundle()),
    context: async () => {
      const loaded = await session.bundle();
      return { duration: bundleSpan(loaded), viewport: loaded.meta.viewport, steps: loaded.steps };
    },
  };
  return session;
}

/** Runs one `replays edit` command and returns what it would print; throws `EditError` (or a sign-in error) on failure. */
export async function executeEdit(argv: readonly string[], env: NodeJS.ProcessEnv = {}, options: EditCliOptions = {}): Promise<EditOutput> {
  const args = parseArgs(argv, { values: VALUE_FLAGS, booleans: BOOLEAN_FLAGS });
  const [target, command, ...rest] = args.positionals;
  if (!target || !command) throw usageError('usage: replays edit <id|viewer-link> <command> ...; run `replays edit --help`');
  if (command === 'undo') throw undoError();
  const handler = Object.hasOwn(HANDLERS, command) ? HANDLERS[command] : undefined;
  if (!handler) throw usageError(`unknown edit command "${command}"; run \`replays edit --help\``);
  args.positionals = rest;
  return handler(await createSession(target, args, env, options), args);
}

/** `replays edit <id|link> <command> ...`; `options.trustedServerUrl` lets a wrapper that adds its own credentials pin the server. */
export async function runEditCli(argv: string[], env: NodeJS.ProcessEnv = {}, options: EditCliOptions = {}) {
  const json = argv.includes('--json');
  try {
    const output = await executeEdit(argv, env, options);
    if (json) process.stdout.write(`${JSON.stringify(output.json)}\n`);
    else process.stdout.write(`${output.text(createTerminal({ env, stream: process.stdout }))}\n`);
  } catch (error) {
    reportFailure(error, json, env);
  }
}
