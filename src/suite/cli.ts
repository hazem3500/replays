import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { flagMap } from '../capture/bundle-io.ts';
import { ReviewSuiteHttpError } from '../capture/review-suite.ts';
import { createTerminal, failureHint, type Terminal } from '../capture/terminal.ts';
import { uploadConfigured } from '../capture/upload.ts';
import { PRODUCT_SLUG } from '../shared/brand.ts';
import { SUITE_USAGE } from './usage.ts';
import { parsePeopleFlags } from '../shared/people.ts';
import { isProfileId } from '../shared/profiles.ts';
import { assertReplayId } from '../shared/replay.ts';
import { assertSummary, suiteOverallStatus, type ReviewRunStatus, type ReviewSuite, type ReviewSuiteRun } from '../shared/review-suite.ts';
import { connect, replayUrl, suiteUrl, type ConnectionFlags } from './connection.ts';
import { RUN_ID_PATTERN, readPlan, type SuitePlanRun } from './plan.ts';
import { recordSuite, type RunOutcome } from './record.ts';
import { addRun, ensureSuite, setRunStatus, setRunSummary, setSuiteSummary } from './service.ts';

class UsageError extends Error {
  readonly exitCode = 2;
}

const CONNECTION = ['server', 'upload-url', 'header-file'];
const SUMMARY_LIMIT_HINT = 'a summary is plain text: paragraphs split by blank lines and "- " bullet lines';

interface Parsed {
  positionals: string[];
  values: Record<string, string>;
  lists: Record<string, string[]>;
  booleans: Set<string>;
}

function parse(argv: string[], spec: { positionals: number; values?: string[]; booleans?: string[]; command: string }): Parsed {
  const booleans = new Set(['json', ...(spec.booleans ?? [])]);
  const split = argv.findIndex((token) => token.startsWith('--') && token !== '--');
  const head = split === -1 ? argv : argv.slice(0, split);
  const positionals = head.filter((token) => token !== '--');
  if (positionals.length !== spec.positionals)
    throw new UsageError(
      `${PRODUCT_SLUG} suite ${spec.command} takes ${spec.positionals} argument${spec.positionals === 1 ? '' : 's'}, got ${positionals.length}; see \`${PRODUCT_SLUG} suite --help\``,
    );
  const known = new Set([...booleans, ...(spec.values ?? []), ...CONNECTION]);
  const parsed = flagMap(split === -1 ? [] : argv.slice(split), booleans);
  for (const name of [...Object.keys(parsed.values), ...parsed.booleans])
    if (!known.has(name)) throw new UsageError(`unknown option --${name} for suite ${spec.command}; see \`${PRODUCT_SLUG} suite --help\``);
  return { positionals, ...parsed };
}

/** Plain text, or `@file` for the file's text. */
async function textArgument(raw: string | undefined, name: string): Promise<string | undefined> {
  if (raw === undefined) return undefined;
  let text = raw;
  if (raw.startsWith('@')) {
    try {
      text = await readFile(resolve(raw.slice(1)), 'utf8');
    } catch {
      throw new UsageError(`${name}: cannot read ${raw.slice(1)}`);
    }
  }
  text = text.replace(/\r\n/g, '\n').trim();
  try {
    assertSummary(text, name);
  } catch {
    throw new UsageError(`${name} must be 1 to 4000 characters of plain text without control characters (${SUMMARY_LIMIT_HINT})`);
  }
  return text;
}

function need(values: Record<string, string>, name: string, command: string): string {
  const value = values[name];
  if (!value) throw new UsageError(`suite ${command} needs --${name}; see \`${PRODUCT_SLUG} suite --help\``);
  return value;
}

function suiteId(value: string) {
  try {
    return assertReplayId(value);
  } catch {
    throw new UsageError('suite id must contain lowercase letters, digits and dashes (at most 80)');
  }
}

function runId(value: string) {
  if (!RUN_ID_PATTERN.test(value)) throw new UsageError('run id must contain letters, digits and hyphens (at most 80)');
  return value;
}

const STATUSES: readonly ReviewRunStatus[] = ['running', 'passed', 'failed', 'partial'];
function status(value: string | undefined): ReviewRunStatus | undefined {
  if (value === undefined) return undefined;
  const found = STATUSES.find((item) => item === value);
  if (!found) throw new UsageError(`--status must be one of ${STATUSES.join(', ')}`);
  return found;
}

export function suiteHint(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof ReviewSuiteHttpError) {
    if (error.status === 0) return 'Check the server address (`replays config`) and your network connection.';
    if (error.status === 401 || error.status === 403)
      return 'This account may not manage suites. Behind a sign-in proxy pass the host credentials with --header-file; otherwise run `replays login`.';
    if (error.status === 404) return 'Check the suite id with `replays suite list`.';
    if (error.status === 409)
      return 'A suite keeps its title, source and profile, and a run keeps its label and finished status; use a new id.';
    if (error.status === 413 || error.status === 400 || error.status === 422) return 'The server refused a field; the message says which.';
    if (error.status >= 500) return 'The server had a problem; try again in a moment.';
  }
  if (/was not found; create it/.test(message)) return undefined;
  return failureHint(message);
}

function report(error: unknown, json: boolean, env: NodeJS.ProcessEnv) {
  const message = error instanceof Error ? error.message : String(error);
  const hint = suiteHint(error);
  const term = createTerminal({ env, stream: process.stderr, json });
  if (term.fancy) process.stderr.write(`\n${term.failed(message)}${hint ? `\n  ${term.dim(`→ ${hint}`)}` : ''}\n`);
  else process.stderr.write(`${JSON.stringify({ success: false, error: message, ...(hint ? { hint } : {}) })}\n`);
  const code =
    typeof error === 'object' && error !== null && 'exitCode' in error && typeof error.exitCode === 'number' ? error.exitCode : 1;
  process.exitCode = code;
}

const print = (text: string) => process.stdout.write(`${text}\n`);
const printJson = (value: Record<string, unknown>) => print(JSON.stringify({ success: true, ...value }));

const seconds = (ms: number | undefined) => (ms === undefined ? '-' : `${(ms / 1000).toFixed(1)}s`);
const firstLine = (text: string | undefined, max = 60) => {
  const line =
    (text ?? '')
      .split('\n')
      .find((part) => part.trim())
      ?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

function paint(term: Terminal, state: string) {
  if (state === 'passed' || state === 'Complete') return term.green(state);
  if (state === 'failed' || state === 'upload-failed' || state === 'Failed') return term.red(state);
  if (state === 'running' || state === 'Running' || state === 'partial' || state === 'Partial') return term.yellow(state);
  return term.dim(state);
}

function table(term: Terminal, header: string[], rows: Array<Array<{ text: string; shown?: string }>>) {
  const widths = header.map((name, column) => Math.max(name.length, ...rows.map((row) => row[column]?.text.length ?? 0)));
  const line = (cells: Array<{ text: string; shown?: string }>) =>
    `  ${cells
      .map((cell, column) => (cell.shown ?? cell.text) + ' '.repeat(Math.max(0, (widths[column] ?? 0) - cell.text.length)))
      .join('  ')
      .trimEnd()}`;
  return [term.dim(line(header.map((name) => ({ text: name })))), ...rows.map(line)].join('\n');
}

const runRow = (term: Terminal, run: ReviewSuiteRun, server: string, suite: string) => {
  const link = run.replayId ? term.link(replayUrl(server, suite, run.replayId)) : '-';
  return [
    { text: run.id },
    { text: run.status, shown: paint(term, run.status) },
    { text: seconds(run.recording?.duration) },
    { text: run.replayId ? replayUrl(server, suite, run.replayId) : '-', shown: link },
    { text: firstLine(run.summary) },
  ];
};

function showFields(suite: ReviewSuite, server: string) {
  return {
    id: suite.id,
    title: suite.title,
    url: suiteUrl(server, suite.id),
    status: suiteOverallStatus(suite.runs),
    createdAt: suite.createdAt,
    ...(suite.profile ? { profile: suite.profile } : {}),
    ...(suite.subject ? { source: suite.subject.url } : {}),
    ...(suite.people?.length ? { people: suite.people } : {}),
    ...(suite.summary ? { summary: suite.summary } : {}),
    runs: suite.runs.map((run) => ({
      id: run.id,
      sequence: run.sequence,
      title: run.label,
      status: run.status,
      startedAt: run.startedAt,
      ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
      ...(run.replayId ? { replayId: run.replayId, replayUrl: replayUrl(server, suite.id, run.replayId) } : {}),
      ...(run.recording ? { duration: run.recording.duration, steps: run.recording.steps } : {}),
      ...(run.summary ? { summary: run.summary } : {}),
    })),
  };
}

async function create(argv: string[], env: NodeJS.ProcessEnv) {
  const { values, lists, booleans } = parse(argv, {
    command: 'create',
    positionals: 0,
    values: ['id', 'title', 'profile', 'source', 'person', 'summary'],
  });
  const json = booleans.has('json');
  const id = suiteId(need(values, 'id', 'create'));
  const title = need(values, 'title', 'create');
  if (title.length > 160) throw new UsageError('--title can be at most 160 characters');
  if (values.profile !== undefined && !isProfileId(values.profile))
    throw new UsageError('--profile must be a profile id (lower-case letters, digits and "-")');
  const people = parsePeopleFlags(lists.person ?? []);
  const summary = await textArgument(values.summary, '--summary');
  const { server, api } = await connect(values as ConnectionFlags);
  const { suite, created } = await ensureSuite(api, { id, title, profile: values.profile, source: values.source, people, summary });
  const url = suiteUrl(server, id);
  if (json) return printJson({ id, title: suite.title, url, created, status: suiteOverallStatus(suite.runs), runs: suite.runs.length });
  const out = createTerminal({ env, stream: process.stdout });
  print(
    out.fancy
      ? `${out.header()}\n\n${out.ok(created ? 'Suite registered' : 'Suite already registered')}\n\n${out.keyValue([
          ['Suite', out.link(url)],
          ['Title', suite.title],
        ])}`
      : url,
  );
}

async function list(argv: string[], env: NodeJS.ProcessEnv) {
  const { values, booleans } = parse(argv, { command: 'list', positionals: 0, values: ['limit'], booleans: ['mine'] });
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && !(Number.isSafeInteger(limit) && limit > 0 && limit <= 200))
    throw new UsageError('--limit must be a whole number from 1 to 200');
  const { server, api } = await connect(values as ConnectionFlags);
  const suites = await api.listSuites({ mine: booleans.has('mine'), ...(limit ? { limit } : {}) });
  if (booleans.has('json'))
    return printJson({
      suites: suites.map((suite) => ({ ...suite, url: suiteUrl(server, suite.id) })),
    });
  const out = createTerminal({ env, stream: process.stdout });
  if (!suites.length) return print(booleans.has('mine') ? 'No suites name you.' : 'No suites yet.');
  const rows = suites.map((suite) => {
    const state =
      suite.runs === 0
        ? 'Waiting'
        : suite.running
          ? 'Running'
          : suite.failed
            ? 'Failed'
            : suite.partial || suite.missingRecordings
              ? 'Partial'
              : 'Complete';
    return [
      { text: suite.id },
      { text: state, shown: paint(out, state) },
      { text: `${suite.runs} run${suite.runs === 1 ? '' : 's'}` },
      { text: suite.title.slice(0, 50) },
      { text: suiteUrl(server, suite.id), shown: out.link(suiteUrl(server, suite.id)) },
    ];
  });
  print(table(out, ['SUITE', 'STATUS', 'RUNS', 'TITLE', 'LINK'], rows));
}

async function show(argv: string[], env: NodeJS.ProcessEnv) {
  const { positionals, values, booleans } = parse(argv, { command: 'show', positionals: 1 });
  const id = suiteId(positionals[0]!);
  const { server, api } = await connect(values as ConnectionFlags);
  const suite = await api.getSuite(id);
  if (!suite) throw new ReviewSuiteHttpError(404, `no suite ${id}`, 'suite lookup');
  if (booleans.has('json')) return printJson({ suite: showFields(suite, server) });
  const out = createTerminal({ env, stream: process.stdout });
  const state = suiteOverallStatus(suite.runs);
  const head: Array<[string, string]> = [
    ['Suite', out.link(suiteUrl(server, id))],
    ['Title', suite.title],
    ['Status', paint(out, state)],
    ...(suite.profile ? ([['Profile', suite.profile]] as Array<[string, string]>) : []),
    ...(suite.subject ? ([['Source', suite.subject.label ?? suite.subject.url]] as Array<[string, string]>) : []),
  ];
  const summary = suite.summary ? `\n\n${suite.summary}` : '';
  const runs = suite.runs.length
    ? `\n\n${table(
        out,
        ['RUN', 'STATUS', 'TIME', 'REPLAY', 'SUMMARY'],
        suite.runs.map((run) => runRow(out, run, server, id)),
      )}`
    : '\n\n  No runs yet.';
  print(`${out.fancy ? `${out.header()}\n\n` : ''}${out.keyValue(head)}${summary}${runs}`);
}

async function suiteSummary(argv: string[], env: NodeJS.ProcessEnv) {
  const { positionals, values, booleans } = parse(argv, { command: 'summary', positionals: 2 });
  const id = suiteId(positionals[0]!);
  const text = (await textArgument(positionals[1], 'summary'))!;
  const { server, api } = await connect(values as ConnectionFlags);
  await setSuiteSummary(api, id, text);
  done(booleans.has('json'), env, 'Suite summary saved', { id, url: suiteUrl(server, id) }, suiteUrl(server, id));
}

function done(json: boolean, env: NodeJS.ProcessEnv, message: string, fields: Record<string, unknown>, link: string) {
  if (json) return printJson(fields);
  const out = createTerminal({ env, stream: process.stdout });
  print(out.fancy ? `${out.ok(message)}\n\n${out.keyValue([['Link', out.link(link)]])}` : link);
}

async function runCommand(argv: string[], env: NodeJS.ProcessEnv) {
  const [action, ...rest] = argv;
  if (action === 'add') {
    const { positionals, values, booleans } = parse(rest, {
      command: 'run add',
      positionals: 1,
      values: ['run', 'title', 'status', 'summary'],
    });
    const suite = suiteId(positionals[0]!);
    const id = runId(need(values, 'run', 'run add'));
    const title = need(values, 'title', 'run add');
    if (title.length > 160) throw new UsageError('--title can be at most 160 characters');
    const { server, api } = await connect(values as ConnectionFlags);
    const { run } = await addRun(api, suite, {
      id,
      title,
      status: status(values.status) ?? 'running',
      summary: await textArgument(values.summary, '--summary'),
    });
    const link = suiteUrl(server, suite);
    return done(
      booleans.has('json'),
      env,
      `Run ${id} is ${run.status}`,
      { suite, run: { id, title: run.label, status: run.status, sequence: run.sequence }, url: link },
      link,
    );
  }
  if (action === 'set') {
    const { positionals, values, booleans } = parse(rest, { command: 'run set', positionals: 2, values: ['status', 'summary'] });
    const [suite, id] = [suiteId(positionals[0]!), runId(positionals[1]!)];
    const target = status(values.status);
    const text = await textArgument(values.summary, '--summary');
    if (!target && !text) throw new UsageError('suite run set needs --status passed|failed, --summary, or both');
    const { server, api } = await connect(values as ConnectionFlags);
    const run = target ? (await setRunStatus(api, suite, id, target, text)).run : (await setRunSummary(api, suite, id, text!)).run;
    const link = suiteUrl(server, suite);
    return done(
      booleans.has('json'),
      env,
      `Run ${id} is ${run.status}`,
      { suite, run: { id, status: run.status, ...(run.summary ? { summary: run.summary } : {}) }, url: link },
      link,
    );
  }
  if (action === 'summary') {
    const { positionals, values, booleans } = parse(rest, { command: 'run summary', positionals: 3 });
    const [suite, id] = [suiteId(positionals[0]!), runId(positionals[1]!)];
    const { server, api } = await connect(values as ConnectionFlags);
    await setRunSummary(api, suite, id, (await textArgument(positionals[2], 'summary'))!);
    const link = suiteUrl(server, suite);
    return done(booleans.has('json'), env, `Run ${id} summary saved`, { suite, run: { id }, url: link }, link);
  }
  throw new UsageError(`unknown command: suite run ${action ?? ''}; expected add, set or summary`);
}

const planLines = (runs: readonly SuitePlanRun[]) =>
  runs.map((run) => ({
    id: run.id,
    title: run.title,
    url: run.url,
    steps: run.steps.length,
    viewport: `${run.viewport.width}x${run.viewport.height}`,
    ...(run.expect ? { expect: run.expect } : {}),
    ...(run.summary ? { summary: run.summary } : {}),
  }));

async function record(argv: string[], env: NodeJS.ProcessEnv) {
  const { values, lists, booleans } = parse(argv, {
    command: 'record',
    positionals: 0,
    values: ['plan', 'only', 'output', 'driver', 'network', 'config', 'context-file', 'step-pause', 'tag'],
    booleans: ['upload', 'dry-run', 'rerecord', 'login', 'video', 'headed', 'no-performance'],
  });
  const json = booleans.has('json');
  const plan = await readPlan(need(values, 'plan', 'record'));
  const only = lists.only ?? [];
  const unknown = only.find((id) => !plan.runs.some((run) => run.id === id));
  if (unknown) throw new UsageError(`--only ${unknown} is not in the plan (runs: ${plan.runs.map((run) => run.id).join(', ')})`);
  const selected = only.length ? plan.runs.filter((run) => only.includes(run.id)) : plan.runs;
  const uploading = booleans.has('upload') || Boolean(values['upload-url']);
  const output = resolve(values.output ?? join('replays-suites', plan.id));
  const out = createTerminal({ env, stream: process.stdout, json });

  if (booleans.has('dry-run')) {
    const server = uploading || values.server ? (await connect(values as ConnectionFlags)).server : undefined;
    const fields = {
      dryRun: true,
      suite: {
        id: plan.id,
        title: plan.title,
        ...(server ? { url: suiteUrl(server, plan.id) } : {}),
        ...(plan.profile ? { profile: plan.profile } : {}),
        ...(plan.source ? { source: plan.source } : {}),
      },
      upload: uploading,
      output,
      runs: planLines(selected),
    };
    if (json) return printJson(fields);
    print(
      `${out.fancy ? `${out.header()}\n\n` : ''}Dry run: nothing is recorded or sent. The plan is valid.\n\n${out.keyValue([
        ['Suite', plan.id],
        ['Title', plan.title],
        ['Upload', uploading ? 'yes' : 'no (add --upload)'],
        ['Recordings', output],
      ])}\n\n${table(
        out,
        ['RUN', 'STEPS', 'VIEWPORT', 'URL'],
        fields.runs.map((run) => [{ text: run.id }, { text: String(run.steps) }, { text: run.viewport }, { text: run.url }]),
      )}`,
    );
    return;
  }

  const connection = uploading ? await connect(values as ConnectionFlags) : undefined;
  const { recordRunWithCapture } = await import('./record-capture.ts');
  const flags = {
    driver: values.driver,
    network: values.network,
    config: values.config,
    contextFile: values['context-file'],
    stepPause: values['step-pause'],
    video: booleans.has('video'),
    headed: booleans.has('headed'),
    noPerformance: booleans.has('no-performance'),
    tags: lists.tag ?? [],
  };
  let forceLogin = booleans.has('login');
  const live = !json;
  let spinner = out.spinner('');
  let index = 0;
  if (live && connection)
    print(
      `${out.fancy ? `${out.header()}\n\n` : ''}${out.keyValue([
        ['Suite', out.link(suiteUrl(connection.server, plan.id))],
        ['Runs', String(selected.length)],
      ])}\n`,
    );
  const result = await recordSuite(plan, selected, {
    connection,
    outputDirFor: (run) => join(output, run.id),
    recordRun: (run, replayId, dir) => recordRunWithCapture(plan, run, replayId, dir, flags, booleans.has('rerecord')),
    uploadRun: async (bundle, dir) => {
      const first = forceLogin;
      forceLogin = false;
      spinner.stop();
      return uploadConfigured(bundle, dir, {
        ...(values['upload-url'] ? { uploadUrl: values['upload-url'] } : {}),
        ...(values.server ? { serverName: values.server } : {}),
        ...(values['header-file'] ? { headerFile: values['header-file'] } : {}),
        ...(first ? { forceLogin: true } : {}),
      });
    },
    retryCommand: (run) =>
      `${PRODUCT_SLUG} suite record --plan ${values.plan} --upload --only ${run.id}${values.output ? ` --output ${values.output}` : ''}${values.server ? ` --server ${values.server}` : ''}`,
    onStart: (run) => {
      index += 1;
      if (live) spinner = out.spinner(`Recording ${run.id} (${index}/${selected.length})`);
    },
    onResult: (outcome) => {
      spinner.stop();
      if (!live) return;
      print(resultLine(out, outcome));
    },
  });
  spinner.stop();
  if (json) printJson({ ...result, success: result.failed === 0 });
  else {
    const counts = ['passed', 'failed', 'upload-failed', 'skipped'].flatMap((state) => {
      const n = result.runs.filter((run) => run.status === state).length;
      return n ? [`${n} ${state}`] : [];
    });
    const retries = result.runs.flatMap((run) => (run.retry ? [`  ${out.dim('retry')} ${run.retry}`] : []));
    const kept =
      !connection && result.runs.some((run) => run.outputDir)
        ? [`\n  ${out.dim(`Recordings kept in ${output}; add --upload to register the suite and upload them.`)}`]
        : [];
    print(
      `\n${counts.join(', ') || 'nothing to record'}${result.suite.url ? `\n\n${out.keyValue([['Suite', out.link(result.suite.url)]])}` : ''}${retries.length ? `\n\n${retries.join('\n')}` : ''}${kept.join('')}`,
    );
  }
  if (result.failed) process.exitCode = 1;
}

function resultLine(out: Terminal, outcome: RunOutcome) {
  const mark = outcome.status === 'passed' ? out.green('✓') : outcome.status === 'skipped' ? out.dim('-') : out.red('✗');
  const where = outcome.replayUrl ? out.link(outcome.replayUrl) : outcome.outputDir ? out.dim(outcome.outputDir) : '';
  const head =
    `  ${mark} ${outcome.id.padEnd(24)} ${paint(out, outcome.status).padEnd(out.fancy ? 24 : 14)} ${seconds(outcome.duration).padStart(6)}  ${where}`.trimEnd();
  const detail = outcome.error ?? outcome.note;
  return detail ? `${head}\n      ${out.dim(detail)}` : head;
}

/** `replays suite …` */
export async function runSuiteCli(argv: string[], env: NodeJS.ProcessEnv = {}) {
  const json = argv.includes('--json');
  try {
    const [command, ...rest] = argv;
    switch (command) {
      case 'create':
        return await create(rest, env);
      case 'list':
        return await list(rest, env);
      case 'show':
        return await show(rest, env);
      case 'summary':
        return await suiteSummary(rest, env);
      case 'run':
        return await runCommand(rest, env);
      case 'record':
        return await record(rest, env);
      case undefined:
        process.stdout.write(`${SUITE_USAGE}\n`);
        return;
      default:
        throw new UsageError(`unknown command: suite ${command}; run \`${PRODUCT_SLUG} suite --help\``);
    }
  } catch (error) {
    report(error, json, env);
  }
}
