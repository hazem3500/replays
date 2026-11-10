import { ReviewSuiteHttpError } from '../capture/review-suite.ts';
import { createTerminal, type Terminal } from '../capture/terminal.ts';
import { PRODUCT_SLUG } from '../shared/brand.ts';
import { parsePeopleFlags } from '../shared/people.ts';
import { isProfileId } from '../shared/profiles.ts';
import { suiteOverallStatus, type ReviewSuite, type ReviewSuiteRun } from '../shared/review-suite.ts';
import { record } from './cli-record.ts';
import {
  firstLine,
  need,
  paint,
  parse,
  print,
  printJson,
  report,
  runId,
  seconds,
  status,
  suiteId,
  table,
  textArgument,
  UsageError,
  type Cell,
} from './cli-io.ts';
import { connect, replayUrl, suiteUrl } from './connection.ts';
import { addRun, ensureSuite, setSuiteSummary, updateRun } from './service.ts';
import { SUITE_USAGE } from './usage.ts';

const TITLE_MAX = 160;

function runRow(term: Terminal, run: ReviewSuiteRun, server: string, suite: string): Cell[] {
  const link = run.replayId ? replayUrl(server, suite, run.replayId) : '-';
  return [
    { text: run.id },
    { text: run.status, shown: paint(term, run.status) },
    { text: seconds(run.recording?.duration) },
    { text: link, shown: run.replayId ? term.link(link) : link },
    { text: firstLine(run.summary) },
  ];
}

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

function done(out: Terminal, message: string, link: string) {
  print(out.fancy ? `${out.ok(message)}\n\n${out.keyValue([['Link', out.link(link)]])}` : link);
}

async function create(argv: string[], env: NodeJS.ProcessEnv) {
  const { values, lists, booleans } = parse(argv, {
    command: 'create',
    positionals: 0,
    values: ['id', 'title', 'profile', 'source', 'person', 'summary'],
  });
  const id = suiteId(need(values, 'id', 'create'));
  const title = need(values, 'title', 'create');
  if (title.length > TITLE_MAX) throw new UsageError(`--title can be at most ${TITLE_MAX} characters`);
  if (values.profile !== undefined && !isProfileId(values.profile))
    throw new UsageError('--profile must be a profile id (lower-case letters, digits and "-")');
  const people = parsePeopleFlags(lists.person ?? []);
  const summary = await textArgument(values.summary, '--summary');
  const { server, api } = await connect(values);
  const { suite, created } = await ensureSuite(api, { id, title, profile: values.profile, source: values.source, people, summary });
  const url = suiteUrl(server, id);
  if (booleans.has('json'))
    return printJson({ id, title: suite.title, url, created, status: suiteOverallStatus(suite.runs), runs: suite.runs.length });
  const out = createTerminal({ env, stream: process.stdout });
  const facts: Array<[string, string]> = [
    ['Suite', out.link(url)],
    ['Title', suite.title],
  ];
  print(
    out.fancy ? `${out.header()}\n\n${out.ok(created ? 'Suite registered' : 'Suite already registered')}\n\n${out.keyValue(facts)}` : url,
  );
}

function listState(suite: { runs: number; running: number; failed: number; partial: number; missingRecordings: number }) {
  if (suite.runs === 0) return 'Waiting';
  if (suite.running) return 'Running';
  if (suite.failed) return 'Failed';
  return suite.partial || suite.missingRecordings ? 'Partial' : 'Complete';
}

async function list(argv: string[], env: NodeJS.ProcessEnv) {
  const { values, booleans } = parse(argv, { command: 'list', positionals: 0, values: ['limit'], booleans: ['mine'] });
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && !(Number.isSafeInteger(limit) && limit > 0 && limit <= 200))
    throw new UsageError('--limit must be a whole number from 1 to 200');
  const { server, api } = await connect(values);
  const suites = await api.listSuites({ mine: booleans.has('mine'), ...(limit ? { limit } : {}) });
  if (booleans.has('json')) return printJson({ suites: suites.map((suite) => ({ ...suite, url: suiteUrl(server, suite.id) })) });
  if (!suites.length) return print(booleans.has('mine') ? 'No suites name you.' : 'No suites yet.');
  const out = createTerminal({ env, stream: process.stdout });
  const rows = suites.map((suite): Cell[] => {
    const state = listState(suite);
    const link = suiteUrl(server, suite.id);
    return [
      { text: suite.id },
      { text: state, shown: paint(out, state) },
      { text: `${suite.runs} run${suite.runs === 1 ? '' : 's'}` },
      { text: suite.title.slice(0, 50) },
      { text: link, shown: out.link(link) },
    ];
  });
  print(table(out, ['SUITE', 'STATUS', 'RUNS', 'TITLE', 'LINK'], rows));
}

async function show(argv: string[], env: NodeJS.ProcessEnv) {
  const { positionals, values, booleans } = parse(argv, { command: 'show', positionals: 1 });
  const id = suiteId(positionals[0]);
  const { server, api } = await connect(values);
  const suite = await api.getSuite(id);
  if (!suite) throw new ReviewSuiteHttpError(404, `no suite ${id}`, 'suite lookup');
  if (booleans.has('json')) return printJson({ suite: showFields(suite, server) });
  const out = createTerminal({ env, stream: process.stdout });
  const head: Array<[string, string]> = [
    ['Suite', out.link(suiteUrl(server, id))],
    ['Title', suite.title],
    ['Status', paint(out, suiteOverallStatus(suite.runs))],
  ];
  if (suite.profile) head.push(['Profile', suite.profile]);
  if (suite.subject) head.push(['Source', suite.subject.label ?? suite.subject.url]);
  const rows = suite.runs.map((run) => runRow(out, run, server, id));
  const runs = rows.length ? table(out, ['RUN', 'STATUS', 'TIME', 'REPLAY', 'SUMMARY'], rows) : '  No runs yet.';
  const sections = [out.keyValue(head), suite.summary, runs].filter(Boolean).join('\n\n');
  print(`${out.fancy ? `${out.header()}\n\n` : ''}${sections}`);
}

async function suiteSummary(argv: string[], env: NodeJS.ProcessEnv) {
  const { positionals, values, booleans } = parse(argv, { command: 'summary', positionals: 2 });
  const id = suiteId(positionals[0]);
  const text = await textArgument(positionals[1], 'summary');
  if (!text) throw new UsageError('suite summary needs the summary text');
  const { server, api } = await connect(values);
  await setSuiteSummary(api, id, text);
  const link = suiteUrl(server, id);
  if (booleans.has('json')) return printJson({ id, url: link });
  done(createTerminal({ env, stream: process.stdout }), 'Suite summary saved', link);
}

async function runAdd(argv: string[], env: NodeJS.ProcessEnv) {
  const { positionals, values, booleans } = parse(argv, {
    command: 'run add',
    positionals: 1,
    values: ['run', 'title', 'status', 'summary'],
  });
  const suite = suiteId(positionals[0]);
  const id = runId(need(values, 'run', 'run add'));
  const title = need(values, 'title', 'run add');
  if (title.length > TITLE_MAX) throw new UsageError(`--title can be at most ${TITLE_MAX} characters`);
  const { server, api } = await connect(values);
  const summary = await textArgument(values.summary, '--summary');
  const { run } = await addRun(api, suite, { id, title, status: status(values.status) ?? 'running', summary });
  const link = suiteUrl(server, suite);
  if (booleans.has('json'))
    return printJson({ suite, run: { id, title: run.label, status: run.status, sequence: run.sequence }, url: link });
  done(createTerminal({ env, stream: process.stdout }), `Run ${id} is ${run.status}`, link);
}

async function runSet(argv: string[], env: NodeJS.ProcessEnv) {
  const { positionals, values, booleans } = parse(argv, { command: 'run set', positionals: 2, values: ['status', 'summary'] });
  const suite = suiteId(positionals[0]);
  const id = runId(positionals[1]);
  const target = status(values.status);
  const summary = await textArgument(values.summary, '--summary');
  if (!target && !summary) throw new UsageError('suite run set needs --status passed|failed, --summary, or both');
  const { server, api } = await connect(values);
  const { run } = await updateRun(api, suite, { id, status: target, summary });
  const link = suiteUrl(server, suite);
  if (booleans.has('json'))
    return printJson({ suite, run: { id, status: run.status, ...(run.summary ? { summary: run.summary } : {}) }, url: link });
  done(createTerminal({ env, stream: process.stdout }), `Run ${id} is ${run.status}`, link);
}

async function runSummary(argv: string[], env: NodeJS.ProcessEnv) {
  const { positionals, values, booleans } = parse(argv, { command: 'run summary', positionals: 3 });
  const suite = suiteId(positionals[0]);
  const id = runId(positionals[1]);
  const summary = await textArgument(positionals[2], 'summary');
  if (!summary) throw new UsageError('suite run summary needs the summary text');
  const { server, api } = await connect(values);
  await updateRun(api, suite, { id, summary });
  const link = suiteUrl(server, suite);
  if (booleans.has('json')) return printJson({ suite, run: { id }, url: link });
  done(createTerminal({ env, stream: process.stdout }), `Run ${id} summary saved`, link);
}

function runCommand(argv: string[], env: NodeJS.ProcessEnv) {
  const [action, ...rest] = argv;
  if (action === 'add') return runAdd(rest, env);
  if (action === 'set') return runSet(rest, env);
  if (action === 'summary') return runSummary(rest, env);
  throw new UsageError(`unknown command: suite run ${action ?? ''}; expected add, set or summary`);
}

const COMMANDS: Record<string, (argv: string[], env: NodeJS.ProcessEnv) => Promise<unknown> | unknown> = {
  create,
  list,
  show,
  summary: suiteSummary,
  run: runCommand,
  record,
};

/** `replays suite …` */
export async function runSuiteCli(argv: string[], env: NodeJS.ProcessEnv = {}) {
  try {
    const [command, ...rest] = argv;
    if (command === undefined) {
      process.stdout.write(`${SUITE_USAGE}\n`);
      return;
    }
    const handler = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
    if (!handler) throw new UsageError(`unknown command: suite ${command}; run \`${PRODUCT_SLUG} suite --help\``);
    await handler(rest, env);
  } catch (error) {
    report(error, argv.includes('--json'), env);
  }
}
