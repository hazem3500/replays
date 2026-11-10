import { join, resolve } from 'node:path';

import { uploadConfigured } from '../capture/upload.ts';
import { createTerminal, type Terminal } from '../capture/terminal.ts';
import { PRODUCT_SLUG } from '../shared/brand.ts';
import { connect, suiteUrl } from './connection.ts';
import { need, paint, parse, print, printJson, seconds, table, UsageError, type Parsed } from './cli-io.ts';
import { readPlan, type SuitePlan, type SuitePlanRun } from './plan.ts';
import { recordSuite, type RunOutcome } from './record.ts';
import type { CaptureFlags } from './record-capture.ts';

const header = (out: Terminal) => (out.fancy ? `${out.header()}\n\n` : '');

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

function markOf(out: Terminal, status: RunOutcome['status']) {
  if (status === 'passed') return out.green('✓');
  return status === 'skipped' ? out.dim('-') : out.red('✗');
}

function resultLine(out: Terminal, outcome: RunOutcome) {
  const mark = markOf(out, outcome.status);
  const where = outcome.replayUrl ? out.link(outcome.replayUrl) : out.dim(outcome.outputDir ?? '');
  const head =
    `  ${mark} ${outcome.id.padEnd(24)} ${paint(out, outcome.status).padEnd(out.fancy ? 24 : 14)} ${seconds(outcome.duration).padStart(6)}  ${where}`.trimEnd();
  const detail = outcome.error ?? outcome.note;
  return detail ? `${head}\n      ${out.dim(detail)}` : head;
}

interface RecordSetup {
  plan: SuitePlan;
  selected: SuitePlanRun[];
  uploading: boolean;
  output: string;
  parsed: Parsed;
}

async function dryRun(setup: RecordSetup, out: Terminal) {
  const { plan, selected, uploading, output, parsed } = setup;
  const server = uploading || parsed.values.server ? (await connect(parsed.values)).server : undefined;
  const runs = planLines(selected);
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
    runs,
  };
  if (parsed.booleans.has('json')) return printJson(fields);
  const rows = runs.map((run) => [{ text: run.id }, { text: String(run.steps) }, { text: run.viewport }, { text: run.url }]);
  const facts: Array<[string, string]> = [
    ['Suite', plan.id],
    ['Title', plan.title],
    ['Upload', uploading ? 'yes' : 'no (add --upload)'],
    ['Recordings', output],
  ];
  print(
    `${header(out)}Dry run: nothing is recorded or sent. The plan is valid.\n\n${out.keyValue(facts)}\n\n${table(out, ['RUN', 'STEPS', 'VIEWPORT', 'URL'], rows)}`,
  );
}

function summaryText(out: Terminal, setup: RecordSetup, result: Awaited<ReturnType<typeof recordSuite>>) {
  const counts = ['passed', 'failed', 'upload-failed', 'skipped'].flatMap((state) => {
    const n = result.runs.filter((run) => run.status === state).length;
    return n ? [`${n} ${state}`] : [];
  });
  const retries = result.runs.flatMap((run) => (run.retry ? [`  ${out.dim('retry')} ${run.retry}`] : []));
  const local = !setup.uploading && result.runs.some((run) => run.outputDir);
  const link = result.suite.url ? `\n\n${out.keyValue([['Suite', out.link(result.suite.url)]])}` : '';
  const retry = retries.length ? `\n\n${retries.join('\n')}` : '';
  const kept = local ? `\n\n  ${out.dim(`Recordings kept in ${setup.output}; add --upload to register the suite and upload them.`)}` : '';
  return `\n${counts.join(', ') || 'nothing to record'}${link}${retry}${kept}`;
}

function captureFlags(parsed: Parsed): CaptureFlags {
  const { values, lists, booleans } = parsed;
  return {
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
}

async function setupOf(argv: string[]): Promise<RecordSetup> {
  const parsed = parse(argv, {
    command: 'record',
    positionals: 0,
    values: ['plan', 'only', 'output', 'driver', 'network', 'config', 'context-file', 'step-pause', 'tag'],
    booleans: ['upload', 'dry-run', 'rerecord', 'login', 'video', 'headed', 'no-performance'],
  });
  const { values, lists, booleans } = parsed;
  const plan = await readPlan(need(values, 'plan', 'record'));
  const only = lists.only ?? [];
  const unknown = only.find((id) => !plan.runs.some((run) => run.id === id));
  if (unknown) throw new UsageError(`--only ${unknown} is not in the plan (runs: ${plan.runs.map((run) => run.id).join(', ')})`);
  return {
    plan,
    parsed,
    selected: only.length ? plan.runs.filter((run) => only.includes(run.id)) : plan.runs,
    uploading: booleans.has('upload') || Boolean(values['upload-url']),
    output: resolve(values.output ?? join('replays-suites', plan.id)),
  };
}

function retryCommand(values: Record<string, string>, run: SuitePlanRun) {
  const output = values.output ? ` --output ${values.output}` : '';
  const server = values.server ? ` --server ${values.server}` : '';
  return `${PRODUCT_SLUG} suite record --plan ${values.plan} --upload --only ${run.id}${output}${server}`;
}

function uploadOptions(values: Record<string, string>, forceLogin: boolean) {
  return {
    ...(values['upload-url'] ? { uploadUrl: values['upload-url'] } : {}),
    ...(values.server ? { serverName: values.server } : {}),
    ...(values['header-file'] ? { headerFile: values['header-file'] } : {}),
    ...(forceLogin ? { forceLogin: true } : {}),
  };
}

export async function record(argv: string[], env: NodeJS.ProcessEnv) {
  const setup = await setupOf(argv);
  const { plan, selected, uploading, output, parsed } = setup;
  const { values, booleans } = parsed;
  const json = booleans.has('json');
  const out = createTerminal({ env, stream: process.stdout, json });
  if (booleans.has('dry-run')) return dryRun(setup, out);

  const connection = uploading ? await connect(values) : undefined;
  const { recordRunWithCapture } = await import('./record-capture.ts');
  const flags = captureFlags(parsed);
  let forceLogin = booleans.has('login');
  let spinner = out.spinner('');
  let index = 0;
  if (!json && connection)
    print(
      `${header(out)}${out.keyValue([
        ['Suite', out.link(suiteUrl(connection.server, plan.id))],
        ['Runs', String(selected.length)],
      ])}\n`,
    );
  const result = await recordSuite(plan, selected, {
    connection,
    outputDirFor: (run) => join(output, run.id),
    recordRun: (run, replayId, outputDir) => recordRunWithCapture({ plan, run, replayId, outputDir }, flags, booleans.has('rerecord')),
    uploadRun: (bundle, dir) => {
      const first = forceLogin;
      forceLogin = false;
      spinner.stop();
      return uploadConfigured(bundle, dir, uploadOptions(values, first));
    },
    retryCommand: (run) => retryCommand(values, run),
    onStart: (run) => {
      index += 1;
      if (!json) spinner = out.spinner(`Recording ${run.id} (${index}/${selected.length})`);
    },
    onResult: (outcome) => {
      spinner.stop();
      if (!json) print(resultLine(out, outcome));
    },
  });
  spinner.stop();
  if (json) printJson({ ...result, success: result.failed === 0 });
  else print(summaryText(out, setup, result));
  if (result.failed) process.exitCode = 1;
}
