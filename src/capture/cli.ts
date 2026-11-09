#!/usr/bin/env node
import { commandHelp, renderAgentGuide, renderHelp } from '../command-help.ts';
import { createTerminal } from './terminal.ts';
import { startCliUpdateNotice } from './update-check.ts';
import { PRODUCT_SLUG } from '../shared/brand.ts';

const usage = (stream: typeof process.stdout | typeof process.stderr) => renderHelp(createTerminal({ stream }), { captureOnly: true });

const [command, ...args] = process.argv.slice(2);
const finishUpdateNotice = startCliUpdateNotice(command, args);
const help = commandHelp(command, args);
if (help) process.stdout.write(`${help}\n`);
else
  switch (command) {
    case 'capture':
      await (await import('./capture.ts')).runCaptureCli(args);
      break;
    case 'import':
      await (await import('./import.ts')).runImportCli(args);
      break;
    case 'upload':
      await (await import('./upload.ts')).runUploadCli(args);
      break;
    case 'connect':
      await (await import('./upload.ts')).runConnectCli(args);
      break;
    case 'login':
      await (await import('./upload.ts')).runLoginCli(args);
      break;
    case 'status':
      await (await import('./upload.ts')).runStatusCli(args);
      break;
    case 'logout':
      await (await import('./upload.ts')).runLogoutCli(args);
      break;
    case 'config':
      await (await import('./upload.ts')).runConfigCli(args);
      break;
    case 'doctor':
      await (await import('./upload.ts')).runDoctorCli(args);
      break;
    case 'agent-guide':
      process.stdout.write(`${renderAgentGuide({ captureOnly: true })}\n`);
      break;
    case undefined:
    case '--help':
    case '-h':
    case 'help':
      process.stdout.write(`${usage(process.stdout)}\n`);
      break;
    default:
      process.stderr.write(
        ['serve', 'migrate', 'build-static', 'plugin', 'mcp'].includes(command)
          ? `${command} requires the full ${PRODUCT_SLUG} distribution; this artifact supports capture and upload only.\n`
          : `unknown command: ${command}\n\n${usage(process.stderr)}\n`,
      );
      process.exitCode = 2;
  }

finishUpdateNotice();
