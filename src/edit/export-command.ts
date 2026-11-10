import { createTerminal } from '../capture/terminal.ts';
import { editListOf } from '../shared/edits.ts';
import type { ParsedArgs } from './args.ts';
import { assertFreeFile, defaultVideoName, exportParams, parseExportSpeed, renderVideo } from './export.ts';
import { type EditOutput, only, positionals, type Session } from './session.ts';
import { parseTime } from './time.ts';
import { resolve } from 'node:path';

export async function exportVideo(session: Session, args: ParsedArgs): Promise<EditOutput> {
  only(args, ['speed', 'captions', 'full', 'output', 'force', 'timeout'], 'export');
  positionals(args, { min: 0, max: 0 }, 'export [--speed 2] [--captions] [-o out.mp4]');
  const { client } = session;
  const current = await client.getEdits();
  const params = exportParams(editListOf(current.edits), {
    speed: parseExportSpeed(args.values.speed),
    captions: args.booleans.has('captions'),
    skipInactive: !args.booleans.has('full'),
  });
  const file = args.values.output ?? defaultVideoName(client.id, params);
  await assertFreeFile(file, args.booleans.has('force'));
  const timeoutMs = args.values.timeout === undefined ? 10 * 60_000 : parseTime(args.values.timeout.replace(/^(\d+)$/, '$1s'));
  const term = createTerminal({ env: session.env, stream: session.stderr, json: session.json });
  const spinner = term.spinner('Rendering the video');
  let lastLine = -1;
  try {
    await renderVideo(client, params, {
      timeoutMs,
      onProgress: (progress, status) => {
        const percent = Math.round(progress * 100);
        spinner.update(`Rendering the video ${percent}%`);
        if (!term.fancy && !session.json && percent - lastLine >= 10) {
          lastLine = percent;
          session.stderr.write(`${status} ${percent}%\n`);
        }
      },
    });
    spinner.update('Downloading the video');
    const bytes = await client.downloadRender(params, resolve(file));
    spinner.stop();
    return {
      json: {
        success: true,
        id: client.id,
        link: client.link,
        action: 'export',
        file,
        bytes,
        speed: params.speed,
        captions: params.captions,
        skipInactive: params.skipInactive,
        edited: Boolean(params.edits),
        revision: current.edits.revision,
      },
      text: (out) =>
        [
          out.ok(`Saved ${file}${bytes ? ` (${(bytes / 1_000_000).toFixed(1)} MB)` : ''}`),
          `  ${out.dim('Viewer')}  ${out.link(client.link)}`,
        ].join('\n'),
    };
  } finally {
    spinner.stop();
  }
}
