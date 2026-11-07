#!/usr/bin/env node
import { PRODUCT_SLUG } from '../shared/brand.ts';

const usage = `${PRODUCT_SLUG} <command> [options]

Capture-only distribution commands:
  capture   record a page into a replay
  import    convert an rrweb recording into a replay
  upload    upload an existing replay
  connect   save a named server URL
  login     sign in using device approval
  status    show server and sign-in state
  logout    remove saved credentials
  config    show or reset local configuration
  doctor    check server connectivity

Run ${PRODUCT_SLUG} capture --help for recording options.
Server, migration and plugin workshop commands require the full distribution.`;

const [command, ...args] = process.argv.slice(2);
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
  case undefined:
  case '--help':
  case '-h':
  case 'help':
    process.stdout.write(`${usage}\n`);
    break;
  default:
    process.stderr.write(
      ['serve', 'migrate', 'build-static', 'plugin', 'mcp'].includes(command)
        ? `${command} requires the full ${PRODUCT_SLUG} distribution; this artifact supports capture and upload only.\n`
        : `unknown command: ${command}\n\n${usage}\n`,
    );
    process.exitCode = 2;
}
