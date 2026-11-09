import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { authorizeBudget, budgetDiff, ratchetBudget, significantGrowth } from './bundle-budgets.mjs';

const file = 'dist/client/assets/Inspector-HASH.css';
const pr = 'https://github.com/hazem3500/replays/pull/62';
const at = (gzip) => ({ [file]: { raw: gzip * 3, gzip, brotli: gzip } });
const base = () => ({ headroomPercent: 3, files: { [file]: { raw: 100, gzip: 50, brotli: 40 } } });
const allowance = () => ({ file, cap: { raw: 130 }, reason: 'Reviewed CSS growth for mobile network search controls.', pr });

describe('reviewed bundle allowances', () => {
  it('rejects a direct cap increase with no allowance', () => {
    const head = base();
    head.files[file].raw = 130;
    assert.equal(authorizeBudget(head, base(), pr).failures.length, 1);
  });
  it('applies a specific allowance without widening other metrics or files', () => {
    const head = { ...base(), allowances: [allowance()] };
    const result = authorizeBudget(head, base(), pr);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.approved.files[file], { raw: 130, gzip: 50, brotli: 40 });
    assert.match(budgetDiff(base(), result.approved, result.allowances), /mobile network search controls/);
    assert.match(budgetDiff(base(), result.approved, result.allowances), /pull\/62/);
  });
  it('rejects an allowance pointing to another PR', () => {
    const head = { ...base(), allowances: [allowance()] };
    const result = authorizeBudget(head, base(), 'https://github.com/hazem3500/replays/pull/66');
    assert.equal(result.approved.files[file].raw, 100);
    assert.match(result.failures.join('\n'), /allowance must link this PR/);
  });
  it('does not recycle an old allowance after an optimization lowered its cap', () => {
    const main = { ...base(), allowances: [allowance()] };
    const head = structuredClone(main);
    head.files[file].raw = 130;
    assert.equal(authorizeBudget(head, main).failures.length, 1);
  });
  it('cannot renew an old allowance by reordering its JSON fields', () => {
    const main = { ...base(), allowances: [allowance()] };
    const record = allowance();
    const head = { ...base(), allowances: [{ pr: record.pr, cap: record.cap, file: record.file, reason: record.reason }] };
    head.files[file].raw = 130;
    assert.equal(authorizeBudget(head, main).failures.length, 1);
  });
  it('requires all metrics when an allowance introduces a new artifact', () => {
    const head = { ...base(), allowances: [{ ...allowance(), file: 'dist/client/assets/new-HASH.js' }] };
    assert.throws(() => authorizeBudget(head, base(), pr), /Invalid bundle ceilings/);
  });
  it('rejects empty reasons and duplicate metric allowances', () => {
    assert.throws(
      () => authorizeBudget({ ...base(), allowances: [{ ...allowance(), reason: 'approved' }] }, base(), pr),
      /specific reason/,
    );
    assert.throws(() => authorizeBudget({ ...base(), allowances: [allowance(), allowance()] }, base(), pr), /Duplicate/);
  });
  it('automatically lowers optimized budgets and never raises an over-budget file', () => {
    const next = ratchetBudget(base(), { [file]: { raw: 60, gzip: 30, brotli: 50 } });
    assert.deepEqual(next.files[file], { raw: 62, gzip: 31, brotli: 40 });
    assert.match(budgetDiff(base(), next, []), /Automatic downward ratchet/);
  });
  it('requires an actual same-run optimization before CI demands lower caps', () => {
    const measured = { [file]: { raw: 90, gzip: 40, brotli: 30 } };
    assert.deepEqual(ratchetBudget(base(), measured, measured).files, base().files);
    const reduced = { [file]: { raw: 60, gzip: 30, brotli: 20 } };
    assert.deepEqual(ratchetBudget(base(), reduced, measured).files[file], { raw: 62, gzip: 31, brotli: 21 });
    const growth = { [file]: { raw: 120, gzip: 60, brotli: 50 } };
    assert.deepEqual(ratchetBudget(base(), growth, measured).files, base().files);
  });
  it('accepts caps within one percent of the headroom target after a small shrink', () => {
    const budget = { ...base(), files: { [file]: { raw: 1000, gzip: 500, brotli: 400 } } };
    const measured = { [file]: { raw: 970, gzip: 485, brotli: 388 } };
    const main = { [file]: { raw: 971, gzip: 486, brotli: 389 } };
    assert.deepEqual(ratchetBudget(budget, measured, main).files[file], { raw: 1000, gzip: 500, brotli: 400 });
    const large = { [file]: { raw: 800, gzip: 400, brotli: 300 } };
    assert.deepEqual(ratchetBudget(budget, large, main).files[file], { raw: 824, gzip: 412, brotli: 309 });
  });
  it('removes budgets and allowance entries when their artifacts disappear', () => {
    const next = ratchetBudget({ ...base(), allowances: [allowance()] }, {});
    assert.deepEqual(next.files, {});
    assert.deepEqual(next.allowances, []);
  });
});

describe('size awareness', () => {
  it('ignores small growth and shrinkage', () => {
    assert.deepEqual(significantGrowth(at(30000), at(29000), base()), []);
    assert.deepEqual(significantGrowth(at(100), at(200), base()), []);
  });
  it('needs both a large ratio and large bytes to fail', () => {
    assert.deepEqual(significantGrowth(at(3000), at(1000), base()), []);
    assert.deepEqual(significantGrowth(at(110000), at(100000), base()), []);
    assert.equal(significantGrowth(at(120000), at(100000), base()).length, 1);
  });
  it('flags only large unbudgeted artifacts', () => {
    assert.deepEqual(significantGrowth({ 'new.js': { raw: 1, gzip: 5000, brotli: 1 } }, at(1), base()), []);
    assert.equal(significantGrowth({ 'new.js': { raw: 1, gzip: 30000, brotli: 1 } }, at(1), base()).length, 1);
  });
});
