import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';

const run = (program, args) => {
  const result = spawnSync(program, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

await Promise.all(['dist/cli', 'dist/lib', 'dist/types'].map((directory) => rm(directory, { recursive: true, force: true })));
run(process.execPath, ['scripts/build-cli.mjs']);
run(process.execPath, ['scripts/build-lib.mjs']);
run('tsrs', ['--fast', 'false', '-p', 'tsconfig.lib.json']);
run(process.execPath, ['scripts/build-recorder.mjs']);
run('tsrs', ['--fast', 'false', '-p', 'tsconfig.recorder.json']);
run(process.execPath, ['scripts/fix-types.mjs']);
