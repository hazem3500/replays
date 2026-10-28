import { isDeepStrictEqual } from 'node:util';

const metrics = ['raw', 'gzip', 'brotli'];
const pullRequest = /^https:\/\/github\.com\/hazem3500\/replays\/pull\/[1-9]\d*$/;
const isCap = (value) => Number.isInteger(value) && value >= 0;
const same = isDeepStrictEqual;

function validateAllowance(allowance) {
  if (
    typeof allowance.file !== 'string' ||
    !allowance.file ||
    typeof allowance.reason !== 'string' ||
    allowance.reason.trim().length < 20 ||
    !pullRequest.test(allowance.pr)
  ) {
    throw new Error('Each bundle allowance needs a file, specific reason (20+ characters), cap and Replays PR link');
  }
  const entries = Object.entries(allowance.cap ?? {});
  if (!entries.length || entries.some(([metric, cap]) => !metrics.includes(metric) || !isCap(cap)))
    throw new Error(`Invalid allowance cap: ${allowance.file}`);
  return entries;
}

export function validateBudget(budget) {
  if (budget.headroomPercent !== 3) throw new Error('Bundle ratchet headroom must stay at 3%');
  for (const [name, limits] of Object.entries(budget.files)) {
    if (metrics.some((metric) => !isCap(limits[metric]))) throw new Error(`Invalid bundle ceilings: ${name}`);
  }
  const seen = new Set();
  for (const allowance of budget.allowances ?? []) {
    const entries = validateAllowance(allowance);
    for (const [metric] of entries) {
      const key = `${allowance.file}/${metric}`;
      if (seen.has(key)) throw new Error(`Duplicate bundle allowance: ${key}`);
      seen.add(key);
    }
  }
}

function newAllowances(budget, baseline, prUrl) {
  return (budget.allowances ?? []).filter((allowance) => {
    if ((baseline.allowances ?? []).some((previous) => same(previous, allowance))) return false;
    return !prUrl || allowance.pr === prUrl;
  });
}

function capIncreaseFailures(budget, baseline, allowances) {
  const failures = [];
  for (const [file, caps] of Object.entries(budget.files)) {
    for (const metric of metrics) {
      if (caps[metric] <= (baseline.files[file]?.[metric] ?? -1)) continue;
      const allowance = allowances.find((entry) => entry.file === file && entry.cap[metric] >= caps[metric]);
      if (!allowance) failures.push(`${file} ${metric}: cap increase requires a new allowance for this PR`);
    }
  }
  return failures;
}

export function authorizeBudget(budget, baseline, prUrl) {
  validateBudget(budget);
  validateBudget(baseline);
  const approved = structuredClone(budget);
  const allowances = newAllowances(budget, baseline, prUrl);
  const failures = [];
  for (const allowance of budget.allowances ?? []) {
    const changed = !(baseline.allowances ?? []).some((previous) => same(previous, allowance));
    if (changed && prUrl && allowance.pr !== prUrl) failures.push(`${allowance.file}: allowance must link this PR (${prUrl})`);
  }
  failures.push(...capIncreaseFailures(budget, baseline, allowances));
  for (const allowance of allowances) {
    for (const [metric, cap] of Object.entries(allowance.cap)) {
      const caps = (approved.files[allowance.file] ??= {});
      caps[metric] = Math.max(caps[metric] ?? 0, cap);
    }
  }
  validateBudget(approved);
  return { approved, failures, allowances };
}

export function ratchetBudget(budget, measured, mainMeasured) {
  const next = structuredClone(budget);
  for (const [file, sizes] of Object.entries(measured)) {
    const caps = next.files[file];
    if (!caps) continue;
    for (const metric of metrics) {
      const mainSize = mainMeasured?.[file]?.[metric];
      if (mainSize !== undefined && sizes[metric] >= mainSize) continue;
      if (caps[metric] !== undefined) caps[metric] = Math.min(caps[metric], Math.ceil(sizes[metric] * 1.03));
    }
  }
  for (const file of Object.keys(next.files)) if (!measured[file]) delete next.files[file];
  if (next.allowances) next.allowances = next.allowances.filter((entry) => measured[entry.file]);
  next.files = Object.fromEntries(Object.entries(next.files).sort(([a], [b]) => a.localeCompare(b)));
  return next;
}

const cell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
function changeReason(allowance, before, after) {
  if (allowance) return `${cell(allowance.reason)} ([PR](${allowance.pr}))`;
  if (after === undefined) return 'Removed artifact';
  if (before !== undefined && after < before) return 'Automatic downward ratchet';
  return 'UNAPPROVED increase';
}

export function budgetDiff(baseline, next, allowances) {
  const rows = [
    '',
    '## Bundle budget changes',
    '',
    '| Artifact | Metric | Main cap | Head cap | Allowance cap | Reason / reviewed PR |',
    '| --- | --- | ---: | ---: | ---: | --- |',
  ];
  for (const file of [...new Set([...Object.keys(baseline.files), ...Object.keys(next.files)])].sort()) {
    for (const metric of metrics) {
      const before = baseline.files[file]?.[metric];
      const after = next.files[file]?.[metric];
      if (before === after) continue;
      const allowance = allowances.find((entry) => entry.file === file && entry.cap[metric] !== undefined);
      const reason = changeReason(allowance, before, after);
      rows.push(
        `| ${cell(file)} | ${metric} | ${before ?? 'new'} | ${after ?? 'removed'} | ${allowance?.cap[metric] ?? 'none'} | ${reason} |`,
      );
    }
  }
  return `${rows.join('\n')}\n`;
}
