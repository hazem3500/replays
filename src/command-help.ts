import { PRODUCT_SLUG } from './shared/brand.ts';

const p = PRODUCT_SLUG;

/** Help for the commands that have no usage text of their own (capture, migrate, build-static and mcp print theirs). */
const COMMAND_HELP: Record<string, string> = {
  import: `usage: ${p} import --rrweb <events.json> --title <text> [options]

  --rrweb <file>        rrweb events JSON (required)
  --title <text>        title shown in the viewer (required)
  --url <url>  --id <id>  --output <dir>
  --tag <tag>           repeatable
  --person <spec>       role:email[:handle=value]; repeatable
  --profile <id>        why it was recorded
  --upload-url <url>  --upload  --login  --server <name>  --header-file <file>`,
  upload: `usage: ${p} upload <replay.json> [--upload-url <endpoint> | --server <name>] [--login] [--header-file <file>] [--profile <id>]`,
  connect: `usage: ${p} connect <server-url> [--name <name>]`,
  login: `usage: ${p} login [--server <name>]

Sign in through the server's advertised OIDC device approval flow.`,
  status: `usage: ${p} status [--server <name>]`,
  logout: `usage: ${p} logout [--server <name>]`,
  config: `usage: ${p} config [reset]`,
  doctor: `usage: ${p} doctor [--server <name>]`,
  serve: `usage: ${p} serve [--dev]

Start the viewer and upload server. Configuration comes from environment variables and ${p}.config.*; see the README.`,
};

/** The command's usage text when the arguments ask for help, so asking never runs the command. */
export function commandHelp(command: string | undefined, args: readonly string[]): string | undefined {
  if (!command || !args.some((arg) => arg === '--help' || arg === '-h')) return undefined;
  return Object.hasOwn(COMMAND_HELP, command) ? COMMAND_HELP[command] : undefined;
}
