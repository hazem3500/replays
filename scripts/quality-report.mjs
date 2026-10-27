// Initial rollout: findings (exit 1) are reported; crashes and missing tools still fail.
// QUALITY_STRICT=1 turns the same commands into gates after the documented cleanup.
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function report(tool, args) {
  const commandArgs = tool === 'pnpm' ? args : ['exec', tool, ...args];
  const result = spawnSync('pnpm', commandArgs, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    // Oxc's raw-transfer buffer can exceed a small CI/Boat worker's virtual memory.
    env: tool === 'knip' ? { ...process.env, KNIP_DISABLE_RAW_TRANSFER: '1' } : process.env,
  });
  const name = tool === 'pnpm' ? 'dedupe' : tool;
  const directory = resolve('.review-artifacts/quality');
  mkdirSync(directory, { recursive: true });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const json = args.includes('json') || args.includes('--json');
  writeFileSync(resolve(directory, `${name}.${json ? 'json' : 'log'}`), stdout);
  writeFileSync(resolve(directory, `${name}.stderr.log`), stderr);
  writeFileSync(
    resolve(directory, `${name}.status.json`),
    JSON.stringify({ status: result.status, signal: result.signal }, null, 2) + '\n',
  );
  if (!json) process.stdout.write(stdout);
  process.stderr.write(stderr);
  if (result.error) throw result.error;
  if (result.signal || result.status === null || result.status > 1)
    throw new Error(`${tool} did not complete: ${result.signal ?? result.status}`);
  if (tool === 'pnpm' && result.status === 1 && !`${stdout}\n${stderr}`.includes('DEDUPE_CHECK_ISSUES')) {
    throw new Error('pnpm dedupe failed without a deduplication report');
  }
  // A configuration error must not masquerade as a clean report.
  const data = json ? JSON.parse(stdout) : undefined;
  if (tool === 'knip') {
    const counts = {};
    for (const issue of data.issues) {
      for (const [kind, findings] of Object.entries(issue)) {
        if (Array.isArray(findings) && findings.length) counts[kind] = (counts[kind] ?? 0) + findings.length;
      }
    }
    console.log('Knip findings:', JSON.stringify(counts));
  }
  if (tool === 'depcruise') {
    const counts = {};
    for (const violation of data.summary.violations) counts[violation.rule.name] = (counts[violation.rule.name] ?? 0) + 1;
    console.log('Boundary findings:', JSON.stringify(counts));
  }
  if (tool === 'attw') console.log('Type-resolution problems:', JSON.stringify(data.problems));
  // dependency-cruiser's JSON reporter returns 0 even when the graph contains violations.
  const failed = result.status !== 0 || (tool === 'depcruise' && data.summary.error > 0);
  const summary = `${tool}: exit ${result.status}, failing findings ${failed ? 'present' : 'none'}; ${process.env.QUALITY_STRICT === '1' ? 'strict' : 'report-only'} (see quality artifact)\n`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  return process.env.QUALITY_STRICT === '1' && failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [tool, ...args] = process.argv.slice(2);
  if (!tool) throw new Error('Expected a quality tool and its arguments');
  process.exitCode = report(tool, args);
}
