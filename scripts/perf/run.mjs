// why: run only against a production build (pnpm build && node scripts/perf/run.mjs); dev mode is refused below.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { cpus, freemem, totalmem, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { runtimeBudgets as config } from '../../budgets/runtime.mjs';
import { startServer } from '../test-server.mjs';
import { measureEndpoints } from './endpoints.mjs';
import { summarize, violations } from './model.mjs';
import { measurePage } from './page.mjs';
import { seedReplays, writePosters } from './seed.mjs';
import { readSettings } from './settings.mjs';

const root = resolve(import.meta.dirname, '../..');
const settings = readSettings();
const { out, samples, prefix } = settings;
await readFile(join(root, 'dist/client/index.html'));
await mkdir(out, { recursive: true });
const seedRoot = await mkdtemp(join(tmpdir(), 'replays-perf-seed-'));

const report = {
  schema: 1,
  mode: config.mode,
  revision: process.env.PERF_REVISION ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  generatedAt: new Date().toISOString(),
  samples,
  experiment: { ssrGate: settings.ssrGate, ssr: settings.serverEnv.REPLAYS_SSR === '1', basePath: prefix, playbackMs: settings.playbackMs },
  hardware: {
    platform: process.platform,
    arch: process.arch,
    cpus: cpus().length,
    cpu: cpus()[0]?.model,
    memoryBytes: totalmem(),
    freeMemoryBytes: freemem(),
    node: process.version,
  },
  profiles: config.profiles,
  pages: {},
  server: {},
  errors: [],
};

const REQUIRED_METRICS = [
  'lcpMs',
  'cls',
  'ttfbMs',
  'tbtMs',
  'longTasks',
  'scriptMs',
  'heapBytes',
  'jsUsedBytes',
  'requests',
  'transferBytes',
];
const PLAYER_METRICS = ['firstFrameMs', 'frameTimeP95Ms', 'mainThreadBusyPct'];

async function scenarioList() {
  const scenarios = { ...config.pages };
  const ids = (await readdir(join(seedRoot, 'sample')))
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => file.slice(0, -5));
  for (const count of settings.compareTiles) {
    scenarios[`comparison-${count}`] = {
      ...config.pages.comparison,
      path: `/r/${ids[0]}?with=${ids.slice(1, count).join(',')}&layout=grid`,
      tiles: count,
    };
  }
  if (settings.selectedPages?.some((page) => !scenarios[page])) throw new Error('PERF_PAGES contains an unknown scenario');
  return scenarios;
}

// why: a route can be intentionally absent on the baseline, and the fallback index must never be measured as the comparison.
async function featureAvailable(ctx, scenario) {
  if (scenario.feature !== 'comparison') return true;
  const probe = await ctx.browser.newPage();
  await probe.goto(`${ctx.server.origin}${prefix}${scenario.path}`);
  const available = await probe
    .locator('[data-testid="compare-stage"]')
    .waitFor({ timeout: 5000 })
    .then(
      () => true,
      () => false,
    );
  await probe.close();
  return available;
}

function assertComplete(row, scenario) {
  if (row.errors.length || row.failedRequests.length) {
    throw new Error(JSON.stringify({ errors: row.errors, failedRequests: row.failedRequests }));
  }
  for (const key of [...REQUIRED_METRICS, ...(scenario.player ? PLAYER_METRICS : [])]) {
    if (!Number.isFinite(row.metrics[key])) throw new Error(`missing required metric: ${key}`);
  }
}

async function sampleScenario(ctx, profileName, name, scenario) {
  const rows = [];
  for (let index = 0; index < samples; index++) {
    try {
      const row = await measurePage(ctx, { profileName, scenarioName: name, scenario, index });
      assertComplete(row, scenario);
      rows.push(row);
    } catch (error) {
      const message = `${profileName}/${name}/${index}: ${error.message}`;
      console.error(message);
      report.errors.push(message);
    }
  }
  return {
    samples: rows,
    median: summarize(rows),
    violations: violations(summarize(rows), config.budgets[profileName]),
  };
}

async function measureProfile(ctx, profileName, scenarios) {
  report.pages[profileName] = {};
  for (const [name, scenario] of Object.entries(scenarios)) {
    if (settings.selectedPages && !settings.selectedPages.includes(name)) continue;
    if (!(await featureAvailable(ctx, scenario))) {
      report.pages[profileName][name] = { unavailable: 'comparison route not shipped in this revision' };
      continue;
    }
    const result = await sampleScenario(ctx, profileName, name, scenario);
    report.pages[profileName][name] = result;
    console.log(`${profileName}/${name}: ${JSON.stringify(result.median)}`);
  }
}

function launchBrowser() {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? process.env.CHROME_PATH;
  return chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--disable-gpu', '--disable-webgl', ...(process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])],
  });
}

function startPerfServer() {
  return startServer({
    env: {
      SAMPLE_DIR: join(seedRoot, 'sample'),
      REPLAYS_BETA_EDITOR: 'true',
      EDITING_ENABLED: 'true',
      POSTERS_DISABLED: '1',
      RENDER_DISABLED: '1',
      ...settings.serverEnv,
    },
  });
}

function enforcementFails() {
  if (config.mode !== 'enforce') return false;
  const pages = Object.values(report.pages).flatMap((profile) => Object.values(profile));
  const endpoints = Object.values(report.server);
  return pages.some((page) => page.unavailable || page.violations?.length) || endpoints.some((endpoint) => endpoint.violations?.length);
}

let server, browser;
try {
  report.seedRows = await seedReplays(seedRoot, settings.seedRows);
  report.seed = 'scripts/demo-seed.mjs';
  server = await startPerfServer();
  browser = await launchBrowser();
  report.hardware.chromium = browser.version();
  await writePosters(browser, server, prefix, seedRoot);
  report.server = await measureEndpoints(server, settings);
  const scenarios = await scenarioList();
  const ctx = { browser, server, settings };
  for (const profileName of Object.keys(config.profiles)) {
    if (settings.selectedProfiles && !settings.selectedProfiles.includes(profileName)) continue;
    await measureProfile(ctx, profileName, scenarios);
  }
} catch (error) {
  report.errors.push(error.stack ?? error.message);
} finally {
  await browser?.close();
  await server?.stop();
  await rm(seedRoot, { recursive: true, force: true });
  await writeFile(join(out, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
}
if (report.errors.length) {
  console.error(report.errors.join('\n'));
  process.exitCode = 1;
} else if (enforcementFails()) process.exitCode = 1;
