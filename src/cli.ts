#!/usr/bin/env node
import { PRODUCT_SLUG } from './shared/brand.ts';

const USAGE = `${PRODUCT_SLUG} <command> [options]

Commands:
  capture   record a page with scripted steps into replay.json (see: ${PRODUCT_SLUG} capture --help)
  import    convert a plain rrweb recording into a replay
  upload    POST an existing replay.json to a server
  serve     start the viewer and upload server (configuration: environment variables, see the README)

Run \`${PRODUCT_SLUG} capture --help\` for the capture options.`;

const [command, ...rest] = process.argv.slice(2);

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
