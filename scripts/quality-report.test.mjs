import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('captures complete JSON when a reporting process exits before its stdout pipe would drain', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'replays-report-'));
  try {
    const bin = join(directory, 'bin');
    await mkdir(bin);
    await writeFile(
      join(bin, 'pnpm'),
      `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({ problems: [], padding: 'x'.repeat(800000) }));\nprocess.exit(0);\n`,
      { mode: 0o755 },
    );
    const script = new URL('./quality-report.mjs', import.meta.url).href;
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { report } from ${JSON.stringify(script)}; process.exitCode = report('attw', ['--format', 'json']);`,
      ],
      {
        cwd: directory,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(await readFile(join(directory, '.review-artifacts/quality/attw.json'), 'utf8'));
    assert.equal(data.padding.length, 800000);
    assert.deepEqual(data.problems, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
