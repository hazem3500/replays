#!/usr/bin/env node
import { commandHelp } from './command-help.ts';
import { PRODUCT_SLUG } from './shared/brand.ts';

const USAGE = `${PRODUCT_SLUG} <command> [options]

Commands:
  capture   record a page with scripted steps into replay.json (see: ${PRODUCT_SLUG} capture --help)
  import    convert a plain rrweb recording into a replay
  upload    POST an existing replay.json to a server
  connect   save a named server URL for future uploads
  login     sign in through an advertised OIDC device approval flow
  status    show the configured server and CLI sign-in state
  logout    remove saved CLI credentials and request provider revocation
  config    show saved server names, or reset local CLI configuration
  doctor    check whether the configured viewer server is reachable
  migrate   copy a store into another, converting stored replays (see: ${PRODUCT_SLUG} migrate --help)
  plugin    check a server/browser/user plugin against a fixture (plugin check --help)
  mcp       MCP server (stdio) for the plugin workshop's agent bridge (beta: REPLAYS_BETA_MALLEABLE)
  serve     start the viewer and upload server (configuration: environment variables, see the README)
  build-static  copy the built viewer to --out <dir> with the base, name, logo and theme stamped in (CDN hosting;
            the API stays on a server): ${PRODUCT_SLUG} build-static --out <dir> [--base /] [--config path]

Run \`${PRODUCT_SLUG} capture --help\` for the capture options.`;

const [command, ...rest] = process.argv.slice(2);

const help = commandHelp(command, rest);
if (help) process.stdout.write(`${help}\n`);
else
  switch (command) {
    case 'capture':
      await (await import('./capture/capture.ts')).runCaptureCli(rest);
      break;
    case 'import':
      await (await import('./capture/import.ts')).runImportCli(rest);
      break;
    case 'upload':
      await (await import('./capture/upload.ts')).runUploadCli(rest);
      break;
    case 'connect':
      await (await import('./capture/upload.ts')).runConnectCli(rest);
      break;
    case 'config':
      await (await import('./capture/upload.ts')).runConfigCli(rest);
      break;
    case 'doctor':
      await (await import('./capture/upload.ts')).runDoctorCli(rest);
      break;
    case 'login':
      await (await import('./capture/upload.ts')).runLoginCli(rest);
      break;
    case 'status':
      await (await import('./capture/upload.ts')).runStatusCli(rest);
      break;
    case 'logout':
      await (await import('./capture/upload.ts')).runLogoutCli(rest);
      break;
    case 'migrate':
      await (await import('./server/migrate-cli.ts')).runMigrateCli(rest);
      break;
    case 'plugin':
      if (rest[0] !== 'check') {
        process.stderr.write('usage: replays plugin check <file> [options]\n');
        process.exitCode = 2;
      } else await (await import('./plugin/check.ts')).runPluginCheckCli(rest.slice(1), process.env);
      break;
    case 'mcp':
      await (await import('./mcp/main.ts')).runMcpCli(rest);
      break;
    case 'build-static':
      await (await import('./server/static.ts')).runBuildStaticCli(rest);
      break;
    case 'serve':
      process.argv = [process.argv[0]!, process.argv[1]!, ...rest];
      await import('./server/main.ts');
      break;
    case undefined:
    case '--help':
    case '-h':
    case 'help':
      process.stdout.write(`${USAGE}\n`);
      break;
    default:
      process.stderr.write(`unknown command: ${command}\n\n${USAGE}\n`);
      process.exitCode = 2;
  }
