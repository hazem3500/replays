#!/usr/bin/env node
import { commandHelp, renderAgentGuide, renderHelp } from './command-help.ts';
import { createTerminal } from './capture/terminal.ts';
import { startCliUpdateNotice } from './capture/update-check.ts';

const usage = (stream: typeof process.stdout | typeof process.stderr) => renderHelp(createTerminal({ stream }));

const [command, ...rest] = process.argv.slice(2);

const finishUpdateNotice = startCliUpdateNotice(command, rest);
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
    case 'agent-guide':
      process.stdout.write(`${renderAgentGuide()}\n`);
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
      process.stdout.write(`${usage(process.stdout)}\n`);
      break;
    default:
      process.stderr.write(`unknown command: ${command}\n\n${usage(process.stderr)}\n`);
      process.exitCode = 2;
  }

finishUpdateNotice();
