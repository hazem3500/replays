import { PRODUCT_SLUG } from './shared/brand.ts';
import { CAPTURE_USAGE } from './capture/capture-usage.ts';
import type { Terminal } from './capture/terminal.ts';

const p = PRODUCT_SLUG;

interface CommandDefinition {
  name: string;
  summary: string;
  /** Usage text for `--help`; commands that print their own (migrate, build-static, mcp, plugin) leave it out. */
  help?: string;
  /** Also available in the capture-only distribution. */
  captureOnly?: true;
}

/** Every command, once: the help screens, `--help` per command and `agent-guide` are all generated from this list. */
export const COMMANDS: readonly CommandDefinition[] = [
  { name: 'capture', summary: 'record a page with scripted steps into replay.json', captureOnly: true, help: CAPTURE_USAGE },
  {
    name: 'import',
    summary: 'convert a plain rrweb recording into a replay',
    captureOnly: true,
    help: `usage: ${p} import --rrweb <events.json> --title <text> [options]

  --rrweb <file>        rrweb events JSON (required)
  --title <text>        title shown in the viewer (required)
  --url <url>  --id <id>  --output <dir>
  --tag <tag>           repeatable
  --person <spec>       role:email[:handle=value]; repeatable
  --profile <id>        why it was recorded
  --upload-url <url>  --upload  --login  --server <name>  --header-file <file>`,
  },
  {
    name: 'upload',
    summary: 'POST an existing replay.json to a server',
    captureOnly: true,
    help: `usage: ${p} upload <replay.json> [--upload-url <endpoint> | --server <name>] [--login] [--header-file <file>] [--profile <id>] [--json]`,
  },
  {
    name: 'connect',
    summary: 'save a named server URL for future uploads',
    captureOnly: true,
    help: `usage: ${p} connect <server-url> [--name <name>]`,
  },
  {
    name: 'login',
    summary: 'sign in through an advertised OIDC device approval flow',
    captureOnly: true,
    help: `usage: ${p} login [--server <name>]

Sign in through the server's advertised OIDC device approval flow.`,
  },
  {
    name: 'status',
    summary: 'show the configured server and CLI sign-in state',
    captureOnly: true,
    help: `usage: ${p} status [--server <name>] [--json]`,
  },
  {
    name: 'logout',
    summary: 'remove saved CLI credentials and request provider revocation',
    captureOnly: true,
    help: `usage: ${p} logout [--server <name>]`,
  },
  {
    name: 'config',
    summary: 'show saved server names, or reset local CLI configuration',
    captureOnly: true,
    help: `usage: ${p} config [reset]`,
  },
  {
    name: 'doctor',
    summary: 'check sign-in, Chrome, ffmpeg, Node and the configured server',
    captureOnly: true,
    help: `usage: ${p} doctor [--server <name>] [--json]

Checks Node, Chrome, ffmpeg, the configured server and your sign-in. Exits 1 when a check fails;
a missing optional tool is reported as a warning. --json prints the checks as one JSON object.`,
  },
  {
    name: 'agent-guide',
    summary: 'print a markdown guide to every command for AI agents',
    captureOnly: true,
    help: `usage: ${p} agent-guide

Prints concise markdown describing the commands, their options, the --json output and the exit codes.`,
  },
  { name: 'migrate', summary: 'copy a store into another, converting stored replays' },
  { name: 'plugin', summary: 'check a server/browser/user plugin against a fixture (plugin check --help)' },
  { name: 'mcp', summary: "MCP server (stdio) for the plugin workshop's agent bridge (beta: REPLAYS_BETA_MALLEABLE)" },
  {
    name: 'serve',
    summary: 'start the viewer and upload server (configuration: environment variables, see the README)',
    help: `usage: ${p} serve [--dev]

Start the viewer and upload server. Configuration comes from environment variables and ${p}.config.*; see the README.`,
  },
  {
    name: 'build-static',
    summary: `copy the built viewer to --out <dir> with the base, name, logo and theme stamped in (CDN hosting; the API stays on a server): ${p} build-static --out <dir> [--base /] [--config path]`,
  },
];

const EXIT_CODES = '0 success, 1 failure, 2 usage error or unknown command, 3 sign-in required, 4 sign-in not possible or refused';

/** The command's usage text when the arguments ask for help, so asking never runs the command. */
export function commandHelp(command: string | undefined, args: readonly string[]): string | undefined {
  if (!command || !args.some((arg) => arg === '--help' || arg === '-h')) return undefined;
  return COMMANDS.find((entry) => entry.name === command)?.help;
}

/** The command list for `replays --help`; `captureOnly` limits it to the commands of the capture-only distribution. */
export function renderHelp(term: Terminal, { captureOnly = false } = {}) {
  const commands = COMMANDS.filter((entry) => !captureOnly || entry.captureOnly);
  const rows = commands.map((entry) => [entry.name, entry.summary] as const);
  return [
    ...(term.fancy ? [term.header(), ''] : []),
    `${p} <command> [options]`,
    '',
    captureOnly ? 'Capture-only distribution commands:' : 'Commands:',
    term.columns(rows),
    '',
    `Run \`${p} <command> --help\` for a command's options, or \`${p} agent-guide\` for a guide written for AI agents.`,
    ...(captureOnly ? ['Server, migration and plugin workshop commands require the full distribution.'] : []),
  ].join('\n');
}

/** Markdown for AI agents, built from the same definitions as `--help` so the two cannot drift. */
export function renderAgentGuide({ captureOnly = false } = {}) {
  const sections = COMMANDS.filter((entry) => !captureOnly || entry.captureOnly).map((entry) => {
    return [`### ${entry.name}`, '', entry.summary, ...(entry.help ? ['', '```text', entry.help, '```'] : []), ''].join('\n');
  });
  return [
    `# ${p}: guide for agents`,
    '',
    `Record browser sessions into replays and upload them. Run \`${p} <command> --help\` for any command's options.`,
    '',
    '## Output contract',
    '',
    '- Results go to stdout, errors to stderr. Output is plain unless a person is at a terminal: no colour or spinners when it is piped, in CI, with `NO_COLOR`, or with `--json`.',
    '- `--json` (capture, upload, status, doctor) prints one JSON object. Success is `{"success":true,...}` on stdout; failure is `{"success":false,"error":"...","hint":"..."}` on stderr (`hint` appears when there is a fix to suggest).',
    `- Exit codes: ${EXIT_CODES}.`,
    '- `doctor --json` lists `checks` (`id`, `status` of `ok`, `warn` or `fail`, `detail`, optional `fix`); run it first when something fails.',
    '',
    '## Commands',
    '',
    ...sections,
  ].join('\n');
}
