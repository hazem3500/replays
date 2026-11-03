import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Bump to rerun every suite everywhere: markers saved under an older version never match again. */
export const CACHE_VERSION = 'v1';

/** Never read by any CI suite: prose, screenshots, GitHub forms and the workflows outside ci.yml. */
const COMMON = [
  '*.md',
  'docs/**/*.md',
  'docs/screenshots/**',
  '.github/ISSUE_TEMPLATE/**',
  '.github/pull_request_template.md',
  '.github/CODEOWNERS',
  'LICENSE',
  '.github/workflows/quality.yml',
  '.github/workflows/pages.yml',
  '.github/workflows/release.yml',
  '.github/workflows/site-dist.yml',
  '.github/workflows/mutation-report.yml',
  '.github/workflows/performance.yml',
];

/** Lint, format, hook, dead-code, mutation and boundary tooling: only the checks suite and Code quality read these. */
const TOOLING = [
  'lefthook.yml',
  'knip.json',
  'stryker.config.mjs',
  'vitest.mutation.config.mjs',
  '.oxlintrc.json',
  '.oxlintrc.types.json',
  '.oxlintrc.next.json',
  '.oxlintrc.types.next.json',
  '.oxfmtrc.json',
  '.dependency-cruiser.cjs',
];

/**
 * Each suite hashes the whole tracked tree minus `exclude` (glob pathspecs), plus `include` added back. ci.yml,
 * .github/actions and this script stay in every suite, so any CI change reruns everything.
 */
export const SUITES = {
  // why: scripts/theme-contract.mjs reads docs/tokens.md; format:check reads budgets/bundle.json.
  checks: { exclude: COMMON, include: ['docs/tokens.md'] },
  e2e: {
    exclude: [
      ...COMMON,
      ...TOOLING,
      'budgets/**',
      'test/**/*.test.ts',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'stories/**',
      '.storybook/**',
      'examples/custom-distro/**',
      'examples/agent-native/**',
      'examples/host-app/**',
      'site/**',
      'vitest.config.ts',
      'vitest.recorder.config.ts',
      'scripts/*.test.mjs',
    ],
  },
  browser: {
    exclude: [...COMMON, ...TOOLING, 'budgets/**', 'e2e/**', 'playwright.config.ts', 'site/**', 'scripts/*.test.mjs'],
    include: ['docs/tokens.md'],
  },
  docker: {
    exclude: [
      ...COMMON,
      ...TOOLING,
      'budgets/**',
      'e2e/**',
      'test/**',
      'stories/**',
      '.storybook/**',
      'src/client/**',
      'src/recorder/**',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'site/**',
      'playwright.config.ts',
      'vitest.config.ts',
      'vitest.recorder.config.ts',
    ],
    // why: the runtime image copies this one client file; the client build itself is proven by the checks suite.
    include: ['src/client/render/frames.ts'],
  },
};

/** Cache marker name to suite; the three end-to-end shards share one input hash but pass separately. */
const MARKERS = { checks: 'checks', 'e2e-1': 'e2e', 'e2e-2': 'e2e', 'e2e-3': 'e2e', browser: 'browser', docker: 'docker' };

function stagedTree(cwd, pathspecs) {
  return execFileSync('git', ['ls-files', '-s', '-z', '--', ...pathspecs], { cwd, maxBuffer: 512 * 1024 * 1024 });
}

/** Content address of a suite's inputs: mode, blob id and path of every selected tracked file, salted with the Node version. */
export function suiteKey(suite, { cwd = process.cwd(), nodeVersion = process.env.NODE_VERSION ?? '' } = {}) {
  const { exclude, include = [] } = SUITES[suite];
  const hash = createHash('sha256').update(`${CACHE_VERSION}\0${suite}\0${nodeVersion}\0`);
  hash.update(stagedTree(cwd, ['.', ...exclude.map((pattern) => `:(exclude,glob)${pattern}`)]));
  if (include.length > 0)
    hash.update('\0include\0').update(
      stagedTree(
        cwd,
        include.map((pattern) => `:(glob)${pattern}`),
      ),
    );
  return hash.digest('hex');
}

function passKeys(options) {
  const hashes = Object.fromEntries(Object.keys(SUITES).map((suite) => [suite, suiteKey(suite, options)]));
  const key = (marker, suite) => `ci-pass-${CACHE_VERSION}-${marker}-${hashes[suite]}`;
  return Object.fromEntries(Object.entries(MARKERS).map(([marker, suite]) => [marker, key(marker, suite)]));
}

/** Scheduled and manual runs are the full drift check: they never reuse an earlier pass. */
const forcesFullRun = (event) => event === 'schedule' || event === 'workflow_dispatch';

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const force = forcesFullRun(process.env.CI_EVENT);
  const keys = passKeys();
  console.log(JSON.stringify({ force, keys }, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    const lines = [`force=${force}`, ...Object.entries(keys).map(([marker, key]) => `${marker}=${key}`)];
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = Object.entries(keys).map(([marker, key]) => `| ${marker} | ${MARKERS[marker]} | \`${key}\` |`);
    const mode = force ? 'Full run: earlier passes are not reused.' : 'Suites whose inputs already passed are reused.';
    const table = ['| Marker | Suite | Key |', '| --- | --- | --- |', ...rows].join('\n');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### CI input keys\n\n${mode}\n\n${table}\n\n`);
  }
}
