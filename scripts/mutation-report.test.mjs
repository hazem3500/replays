import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { summarizeMutations } from './mutation-report.mjs';

const fixture = () => ({
  files: {
    'module.ts': { mutants: [{ status: 'Killed', killedBy: ['killer'] }, { status: 'Survived' }, { status: 'Timeout' }] },
    'other.ts': { mutants: [{ status: 'Killed', killedBy: ['second'] }, { status: 'CompileError' }] },
  },
  testFiles: {
    'module.test.ts': {
      tests: [
        { id: 'killer', name: 'kills' },
        { id: 'second', name: 'also kills' },
        { id: 'zero', name: 'review' },
      ],
    },
  },
});

it('combines kill attribution across reports with different test ids and refuses partial scope', () => {
  const root = mkdtempSync(join(tmpdir(), 'replays-mutation-report-'));
  const script = resolve('scripts/mutation-report.mjs');
  try {
    for (const [name, id, status] of [['first', 'one', 'Killed'], ['second', 'two', 'Survived']]) {
      writeFileSync(join(root, `${name}.json`), JSON.stringify({
        files: { [`${name}.ts`]: { mutants: [{ status, ...(status === 'Killed' ? { killedBy: [id] } : {}) }] } },
        testFiles: { 'contract.test.ts': { tests: [{ id, name: 'preserves the contract' }] } },
      }));
    }
    const manifest = join(root, 'manifest.json');
    writeFileSync(manifest, JSON.stringify({ expected: 2, reports: ['first.json', 'second.json'] }));
    const result = spawnSync(process.execPath, [script, manifest], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /zero attributed kills \(0\/1\)/);
    writeFileSync(manifest, JSON.stringify({ expected: 2, reports: ['first.json'] }));
    const incomplete = spawnSync(process.execPath, [script, manifest], { cwd: root, encoding: 'utf8' });
    assert.equal(incomplete.status, 1);
    assert.match(incomplete.stderr, /scope is incomplete/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('mutation kill attribution', () => {
  it('unions kills across modules and excludes invalid mutants from module scores', () => {
    const result = summarizeMutations(fixture());
    assert.deepEqual(
      result.candidates.map((test) => test.id),
      ['zero'],
    );
    assert.equal(result.modules[0].score, (2 / 3) * 100);
    assert.equal(result.modules[1].score, 100);
  });
  it('refuses missing inventory and incomplete or unattributed results', () => {
    assert.throws(() => summarizeMutations({ files: {} }), /testFiles/);
    const report = fixture();
    report.files['module.ts'].mutants.push({ status: 'Pending' });
    assert.throws(() => summarizeMutations(report), /incomplete/);
    report.files['module.ts'].mutants = [{ status: 'Killed' }];
    assert.throws(() => summarizeMutations(report), /attribution/);
  });
  it('refuses unknown killing-test ids instead of marking the inventory as zero-kill', () => {
    const report = fixture();
    report.files['module.ts'].mutants = [{ status: 'Killed', killedBy: ['missing'] }];
    assert.throws(() => summarizeMutations(report), /Unknown killing test/);
  });
});
