import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { bundleSpan, editListOf, normalizeEdits } from '../shared/edits.ts';
import type { ParsedArgs } from './args.ts';
import { changeLines, diffEdits, listEdits, noChanges } from './describe.ts';
import { EditError, isRecord, messageOf, must, usageError } from './errors.ts';
import { assertFreeFile } from './export.ts';
import { modifyEdits } from './modify.ts';
import { checkEdits, changesText, type EditOutput, mutationOutput, only, positionals, type Session, validator } from './session.ts';
import { stepRows } from './steps.ts';
import { formatTime } from './time.ts';

export async function show(session: Session): Promise<EditOutput> {
  const [bundle, current] = await Promise.all([session.bundle(), session.client.getEdits()]);
  const edits = normalizeEdits(editListOf(current.edits));
  const rows = stepRows(bundle.steps, edits.stepNames);
  const { client } = session;
  return {
    json: {
      success: true,
      id: client.id,
      link: client.link,
      title: bundle.meta.title,
      duration: bundleSpan(bundle),
      revision: current.edits.revision,
      ...(current.edits.updatedBy ? { updatedBy: current.edits.updatedBy } : {}),
      ...(current.edits.updatedAt ? { updatedAt: current.edits.updatedAt } : {}),
      edits: { ...current.edits, ...edits },
      steps: rows.map(({ number, at, time, label, kind, key, renamed, folded }) => ({
        index: number,
        at,
        time,
        label,
        kind,
        key,
        ...(renamed ? { renamed } : {}),
        ...(folded ? { folded } : {}),
      })),
    },
    text: (term) => {
      const saved =
        current.edits.revision > 0
          ? `revision ${current.edits.revision}${current.edits.updatedBy ? `, saved by ${current.edits.updatedBy}` : ''}`
          : 'never edited';
      return [
        `${term.bold(bundle.meta.title)}  ${term.dim(`${client.id} · ${formatTime(bundleSpan(bundle))} · ${saved}`)}`,
        term.link(client.link),
        '',
        term.bold('Edits'),
        ...listEdits(edits).map((line) => `  ${line}`),
        '',
        term.bold('Steps'),
        ...rows.map(
          (row) =>
            `  ${String(row.number).padStart(3)}  ${row.time.padStart(7)}  ${row.label}${row.renamed ? term.dim('  (renamed)') : ''}${row.folded ? term.dim('  (part of the step above)') : ''}`,
        ),
      ].join('\n');
    },
  };
}

export async function pull(session: Session, args: ParsedArgs): Promise<EditOutput> {
  only(args, ['output', 'force'], 'pull');
  positionals(args, { min: 0, max: 0 }, 'pull [-o edits.json]');
  const current = await session.client.getEdits();
  const text = `${JSON.stringify(current.edits, null, 2)}\n`;
  const { client } = session;
  const file = args.values.output;
  if (file) {
    await assertFreeFile(file, args.booleans.has('force'));
    await writeFile(resolve(file), text);
  }
  return {
    json: {
      success: true,
      id: client.id,
      link: client.link,
      revision: current.edits.revision,
      ...(file ? { file } : {}),
      edits: current.edits,
    },
    text: (term) =>
      file
        ? [term.ok(`Saved revision ${current.edits.revision} to ${file}`), `  ${term.dim('Viewer')}  ${term.link(client.link)}`].join('\n')
        : text.trimEnd(),
  };
}

export async function push(session: Session, args: ParsedArgs): Promise<EditOutput> {
  only(args, ['force', 'dry-run'], 'push');
  const [file] = positionals(args, { min: 1, max: 1 }, 'push <edits.json> [--force] [--dry-run]');
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(resolve(must(file)), 'utf8'));
  } catch (error) {
    throw usageError(`could not read ${file} as JSON: ${messageOf(error)}`);
  }
  if (!isRecord(raw)) throw usageError(`${file} must hold a JSON object (the edit list)`);
  const { revision, updatedBy: _by, updatedAt: _at, ...list } = raw;
  const context = await session.context();
  const validate = validator(context.duration);
  checkEdits(list, context.duration);
  const next = normalizeEdits(list);
  const force = args.booleans.has('force');
  const current = await session.client.getEdits();
  const behind = typeof revision === 'number' && revision !== current.edits.revision;
  if (behind && !force)
    throw new EditError(
      `someone else edited this replay since ${file} was pulled (the file is at revision ${String(revision)}, the server at ${current.edits.revision}); run \`replays edit <id> pull\` again, or pass --force to overwrite what is on the server`,
    );
  const plan = diffEdits(normalizeEdits(editListOf(current.edits)), next);
  if (args.booleans.has('dry-run')) {
    const { client } = session;
    return {
      json: { success: true, id: client.id, link: client.link, action: 'push', dryRun: true, changed: !noChanges(plan), changes: plan },
      text: (term) =>
        [
          noChanges(plan) ? term.warn('The server already has these edits.') : term.ok('Dry run; nothing was saved. Pushing would:'),
          ...changesText(term, plan),
        ].join('\n'),
    };
  }
  if (!session.json && !noChanges(plan))
    session.stderr.write(
      `Pushing ${file}:\n${changeLines(plan)
        .map((line) => `  ${line}`)
        .join('\n')}\n`,
    );
  const result = await modifyEdits(session.client, () => next, { validate, retries: force ? 1 : 0 });
  return mutationOutput(session, { action: 'push', headline: `Pushed ${file}` }, result);
}
