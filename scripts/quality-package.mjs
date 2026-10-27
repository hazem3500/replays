// Both validators inspect the same fresh pnpm tarball, including its generated declarations.
// Build first: pnpm build && pnpm build:cli.
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { report } from './quality-report.mjs';

const destination = resolve('dist/quality-pack');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
execFileSync('pnpm', ['pack', '--pack-destination', destination], { stdio: 'inherit' });
const tarballs = (await readdir(destination)).filter((name) => name.endsWith('.tgz'));
if (tarballs.length !== 1) throw new Error('Expected exactly one fresh package tarball');
const tarball = resolve(destination, tarballs[0]);
const publint = report('publint', [tarball, '--strict']);
const types = report('attw', [tarball, '--format', 'json']);
process.exitCode = Math.max(publint, types);
