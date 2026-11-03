import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Bump to rerun every suite everywhere: markers saved under an older version never match again. */
export const CACHE_VERSION = 'v1';

/** The weekly schedule entry that never reuses an earlier pass; the other nightly entries reuse them. */
export const FULL_SCHEDULE = '23 3 * * 1';

/** Label that runs the end-to-end and browser suites on any pull request. */
export const E2E_LABEL = 'run-e2e';

/**
 * Pull requests run the end-to-end, browser and Docker suites only when they touch one of these paths (or carry
 * `run-e2e`). Each entry is code whose failures only a real browser, FFmpeg, the packed tarball or the image shows;
 * everything else is covered by the PR gate's unit tests and still runs these suites on main and nightly.
 */
export const RISKY = [
  // why: the injected recorder and the Node/CDP capture path run inside real pages; unit tests use happy-dom.
  'src/recorder/**',
  'src/capture/**',
  // why: server-side video render drives Chromium and FFmpeg; only the real render test and e2e exports exercise it.
  'src/server/renderer.ts',
  'src/server/render-*.ts',
  'src/server/media/**',
  'src/client/render/**',
  // why: server rendering (the start entry and its build) is only exercised by the e2e server, SSR on and off.
  'src/client/start/**',
  'src/server/start.ts',
  'src/server/index-page.ts',
  'vite.start.config.ts',
  // why: packaging and dependencies change what the tarball, the examples, Playwright and the image install.
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'bin/**',
  'vite.config.ts',
  'scripts/build-lib.mjs',
  'scripts/pack-smoke.mjs',
  'Dockerfile',
  '.dockerignore',
  'playwright.config.ts',
  '.github/actions/browser/**',
];

/** Never read by any suite here: prose, screenshots, GitHub forms and the workflows outside ci.yml. */
const COMMON = [
  '*.md',
  'docs/**/*.md',
  'docs/screenshots/**',
  '.github/ISSUE_TEMPLATE/**',
  '.github/pull_request_template.md',
  '.github/CODEOWNERS',
  'LICENSE',
  '.github/workflows/pages.yml',
  '.github/workflows/release.yml',
  '.github/workflows/site-dist.yml',
  '.github/workflows/mutation-report.yml',
  '.github/workflows/performance.yml',
];

/** Lint, format, hook, dead-code, mutation, boundary and Turborepo tooling: only the PR gate reads these. */
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
  'turbo.json',
  'scripts/ci-size-base.sh',
];

/**
 * Suites Turborepo does not cache. Each hashes the whole tracked tree minus `exclude` (glob pathspecs), plus
 * `include` added back. ci.yml, .github/actions and this script stay in every suite, so any CI change reruns them.
 */
export const SUITES = {
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
      'examples/composed-viewer/**',
      'examples/agent-native/**',
      'examples/host-app/**',
      'site/**',
      'vitest.config.ts',
      'vitest.recorder.config.ts',
      'scripts/*.test.mjs',
    ],
  },
  browser: {
    exclude: [...COMMON, ...TOOLING, 'budgets/**', 'e2e/**', 'playwright.config.ts', 'site/**', 'scripts/*.test.mjs', 'test/**/*.test.ts'],
    // why: the browser job runs these two unit tests; non-test helpers under test/ are never excluded.
    include: ['docs/tokens.md', 'test/render.integration.test.ts', 'test/plugin-check-browser.test.ts'],
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
    // why: the runtime image copies this one client file; the client build itself is proven by the PR gate.
    include: ['src/client/render/frames.ts'],
  },
};

/** Cache marker name to suite; the three end-to-end shards share one input hash but pass separately. */
const MARKERS = {
  'e2e-1': 'e2e',
  'e2e-2': 'e2e',
  'e2e-3': 'e2e',
  browser: 'browser',
  docker: 'docker',
};

function stagedTree(cwd, pathspecs) {
  return execFileSync('git', ['ls-files', '-s', '-z', '--', ...pathspecs], {
    cwd,
    maxBuffer: 512 * 1024 * 1024,
  });
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

/** Files changed since `base` that match a risky path. */
export function riskyChanges(base, { cwd = process.cwd() } = {}) {
  const pathspecs = RISKY.map((pattern) => `:(glob)${pattern}`);
  const output = execFileSync('git', ['diff', '--name-only', base, 'HEAD', '--', ...pathspecs], {
    cwd,
    encoding: 'utf8',
  });
  return output.split('\n').filter(Boolean);
}

/** Why the browser-backed suites run for this event, or an empty string when the PR gate alone covers it. */
export function suitesReason({ event, labels = [], base = '', cwd } = {}) {
  if (event !== 'pull_request') return `${event} run`;
  if (labels.includes(E2E_LABEL)) return `labelled ${E2E_LABEL}`;
  // invariant: without a known base every path counts as changed, so a missing base never skips coverage.
  if (!base) return 'no base commit to compare';
  const files = riskyChanges(base, { cwd });
  return files.length > 0 ? `touches ${files.slice(0, 5).join(', ')}${files.length > 5 ? ` and ${files.length - 5} more` : ''}` : '';
}

/** The weekly schedule and manual runs are the full drift check: they never reuse an earlier pass. */
export const forcesFullRun = (event, schedule = '') =>
  event === 'workflow_dispatch' || (event === 'schedule' && schedule === FULL_SCHEDULE);

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = process.env.CI_EVENT ?? '';
  const force = forcesFullRun(event, process.env.CI_SCHEDULE);
  const reason = suitesReason({
    event,
    labels: JSON.parse(process.env.CI_LABELS || '[]'),
    base: process.env.CI_BASE ?? '',
  });
  const keys = passKeys();
  console.log(JSON.stringify({ force, wanted: reason !== '', reason, keys }, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    const lines = [`force=${force}`, `wanted=${reason !== ''}`, ...Object.entries(keys).map(([marker, key]) => `${marker}=${key}`)];
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = Object.entries(keys).map(([marker, key]) => `| ${marker} | ${MARKERS[marker]} | \`${key}\` |`);
    const why = reason
      ? `End-to-end, browser and Docker suites: wanted (${reason}).`
      : `End-to-end, browser and Docker suites: not wanted; no risky path changed. Add the \`${E2E_LABEL}\` label to run them.`;
    const mode = force ? 'Full run: earlier passes are not reused.' : 'Suites whose inputs already passed are reused.';
    const table = ['| Marker | Suite | Key |', '| --- | --- | --- |', ...rows].join('\n');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Browser-backed suites\n\n${why} ${mode}\n\n${table}\n\n`);
  }
}
