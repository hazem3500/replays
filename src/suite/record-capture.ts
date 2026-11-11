import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { capture, createDriver, parseArgs } from '../capture/capture.ts';
import { assertReplayBundle, type ReplayBundle } from '../shared/replay.ts';
import type { SuitePlan, SuitePlanRun } from './plan.ts';
import type { RecordedRun } from './record.ts';

/** Capture options the plan does not carry; they apply to every run. */
export interface CaptureFlags {
  driver?: string | undefined;
  video?: boolean;
  headed?: boolean;
  network?: string | undefined;
  config?: string | undefined;
  contextFile?: string | undefined;
  stepPause?: string | undefined;
  noPerformance?: boolean;
  tags?: string[];
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

export interface RunTarget {
  plan: SuitePlan;
  run: SuitePlanRun;
  replayId: string;
  outputDir: string;
}

export function captureArgv(target: RunTarget, flags: CaptureFlags): string[] {
  const { plan, run, outputDir, replayId } = target;
  const { width, height } = run.viewport;
  return [
    '--url',
    run.url,
    '--output',
    outputDir,
    '--id',
    replayId,
    '--title',
    run.title,
    '--steps',
    JSON.stringify(run.steps),
    '--viewport',
    `${width}x${height}`,
    '--suite-id',
    plan.id,
    '--run-id',
    run.id,
    ...(plan.profile ? ['--profile', plan.profile] : []),
    ...(plan.source ? ['--source', plan.source] : []),
    ...(flags.driver ? ['--driver', flags.driver] : []),
    ...(flags.network ? ['--network', flags.network] : []),
    ...(flags.config ? ['--config', flags.config] : []),
    ...(flags.contextFile ? ['--context-file', flags.contextFile] : []),
    ...(flags.stepPause ? ['--step-pause', flags.stepPause] : []),
    ...(flags.video ? ['--video'] : []),
    ...(flags.headed ? ['--headed'] : []),
    ...(flags.noPerformance ? ['--no-performance'] : []),
    ...(flags.tags ?? []).flatMap((tag) => ['--tag', tag]),
  ];
}

/**
 * Records one run with the capture command's own code, into `<output>/<run>`. A finished recording already on disk is
 * used as it is (the retry after a failed upload) unless `rerecord` clears it; a half-written folder is cleared.
 */
export async function recordRunWithCapture(target: RunTarget, flags: CaptureFlags, rerecord: boolean): Promise<RecordedRun> {
  const { plan, run, outputDir } = target;
  const file = join(outputDir, 'replay.json');
  if (!rerecord && (await exists(file))) {
    const kept = await readBundle(file);
    if (kept.suiteRun?.suiteId === plan.id && kept.suiteRun.runId === run.id) return { bundle: kept, reused: true };
  }
  await rm(outputDir, { recursive: true, force: true });
  const args = await parseArgs(captureArgv(target, flags));
  const result = await capture(
    { ...args, ...(plan.people.length ? { people: plan.people } : {}) },
    createDriver(args.driver, { headed: args.headed }),
  );
  return { bundle: await readBundle(result.replayPath), reused: false, ...(result.stepEnds ? { stepEnds: result.stepEnds } : {}) };
}

async function readBundle(file: string): Promise<ReplayBundle> {
  const bundle: unknown = JSON.parse(await readFile(file, 'utf8'));
  assertReplayBundle(bundle);
  return bundle;
}
