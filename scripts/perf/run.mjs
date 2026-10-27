// Run only against a production build: pnpm build && node scripts/perf/run.mjs
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { cpus, freemem, totalmem, tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { chromium } from 'playwright-core';
import config from '../../performance-budget.config.mjs';
import { startServer } from '../test-server.mjs';
import { observe } from './observe.mjs';
import { summarize, usedBytes, violations } from './model.mjs';

const root = resolve(import.meta.dirname, '../..');
const out = resolve(process.env.PERF_OUTPUT ?? '.review-artifacts/perf/current');
const samples = Number(process.env.PERF_SAMPLES ?? config.samples);
if (!Number.isInteger(samples) || samples < 1) throw new Error('PERF_SAMPLES must be a positive integer');
await readFile(join(root, 'dist/client/index.html')); // Never silently measure Vite dev mode.
await mkdir(out, { recursive: true });
const seedRoot = await mkdtemp(join(tmpdir(), 'replays-perf-seed-'));
let server, browser;
const report = {
  schema: 1,
  mode: config.mode,
  revision: process.env.PERF_REVISION ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  generatedAt: new Date().toISOString(),
  samples,
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

function rawRequest(url, headers) {
  return new Promise((done, fail) => {
    const start = performance.now();
    const request = httpRequest(url, { headers, agent: false }, (response) => {
      const ttfbMs = performance.now() - start;
      let wireBytes = 0;
      response.on('data', (chunk) => {
        wireBytes += chunk.length;
      });
      response.on('error', fail);
      response.on('end', () =>
        done({
          metrics: { ttfbMs, responseMs: performance.now() - start, wireBytes },
          status: response.statusCode,
          headers: response.headers,
        }),
      );
    });
    request.setTimeout(15_000, () => request.destroy(new Error('server request timed out')));
    request.on('error', fail);
    request.end();
  });
}

async function seed() {
  try {
    await readFile(join(root, 'scripts/demo-seed.mjs'));
    execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'scripts/demo-seed.mjs', '--output', seedRoot], {
      cwd: root,
    });
    report.seed = 'scripts/demo-seed.mjs';
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await cp(join(import.meta.dirname, 'fixtures'), join(seedRoot, 'sample'), { recursive: true, filter: (path) => !path.endsWith('.md') });
    report.seed = 'frozen demo-seed fixture (canonical generator not yet available)';
  }
}

async function waitForFrame(page) {
  await page.waitForFunction(() => window.__perf.firstFrameMs !== null, { timeout: 30_000 });
}

async function interaction(page, scenario) {
  if (scenario.player) {
    await waitForFrame(page);
    const play = page.getByRole('button', { name: /^(Play|Play the result|Play both recordings|Replay from start)$/ }).first();
    await play.click();
    await page.waitForTimeout(config.playbackMs);
    await page
      .getByRole('button', { name: /^(Pause|Pause both recordings)$/ })
      .first()
      .click();
  } else if (scenario.settings) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    const tab = page.getByRole('tab').last();
    await tab.click();
  } else {
    const search = page.getByRole('searchbox');
    if (await search.count()) {
      await search.fill('checkout');
      await search.press('Enter');
      await search.fill('');
    } else {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.keyboard.press('Escape');
    }
  }
  // Let Event Timing and long-task observers deliver after the last interaction.
  await page.waitForTimeout(300);
}

async function measurePage(profileName, scenarioName, scenario, index) {
  const profile = config.profiles[profileName];
  const context = await browser.newContext({
    viewport: scenario.wide ? config.profiles.desktop.viewport : profile.viewport,
    deviceScaleFactor: 1,
  });
  const trace = index === 0;
  if (trace) await context.tracing.start({ screenshots: false, snapshots: false, sources: false });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.addInitScript(observe);
  await page.addInitScript((view) => localStorage.setItem('replays-index-view', view), scenario.view ?? 'list');
  const cdp = await context.newCDPSession(page);
  let requests = 0,
    transferBytes = 0;
  const failedRequests = [];
  const responses = [];
  cdp.on('Network.responseReceived', (event) =>
    responses.push({
      url: event.response.url,
      status: event.response.status,
      mimeType: event.response.mimeType,
      timing: event.response.timing,
    }),
  );
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: profile.latency,
    downloadThroughput: profile.download,
    uploadThroughput: profile.upload,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
  await cdp.send('Performance.enable');
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.startPreciseCoverage', { callCount: false, detailed: true });
  if (trace) await cdp.send('Profiler.start');
  cdp.on('Network.requestWillBeSent', (event) => {
    if (/^https?:/.test(event.request.url)) requests++;
  });
  cdp.on('Network.loadingFinished', (event) => {
    transferBytes += event.encodedDataLength;
  });
  cdp.on('Network.loadingFailed', (event) => {
    if (!event.canceled) failedRequests.push(event.errorText);
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${server.origin}${scenario.path}`, { waitUntil: 'load' });
    await page.locator(scenario.ready).first().waitFor();
    if (scenario.player) await waitForFrame(page);
    await page.waitForTimeout(config.settleMs);
    const readyAt = await page.evaluate(() => performance.now());
    await interaction(page, scenario);
    const vitals = await page.evaluate((observationEnd) => {
      window.__flushPerf();
      const state = window.__perf;
      const navigation = performance.getEntriesByType('navigation')[0];
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
      const durations = Object.values(state.interactions).sort((a, b) => b - a);
      // INP is the p98 interaction latency; a short scripted run uses its worst observed interaction.
      const inpMs = durations[Math.floor(durations.length / 50)] ?? null;
      return {
        lcpMs: state.lcpMs,
        cls: state.supported.includes('layout-shift') ? state.cls : null,
        inpMs,
        ttfbMs: navigation.responseStart - navigation.startTime,
        tbtMs: state.supported.includes('longtask')
          ? state.tasks.reduce(
              (sum, task) => sum + Math.max(0, Math.min(task.start + task.duration, observationEnd) - Math.max(task.start, fcp) - 50),
              0,
            )
          : null,
        longTasks: state.supported.includes('longtask') ? state.tasks.length : null,
        firstFrameMs: state.firstFrameMs,
      };
    }, readyAt);
    if (trace) {
      const { profile: cpuProfile } = await cdp.send('Profiler.stop');
      await writeFile(join(out, `${profileName}-${scenarioName}.cpuprofile`), JSON.stringify(cpuProfile));
    }
    const coverage = await cdp.send('Profiler.takePreciseCoverage');
    const metrics = await cdp.send('Performance.getMetrics');
    const metric = (name) => metrics.metrics.find((item) => item.name === name)?.value ?? null;
    const observations = await page.evaluate(() => ({
      tasks: window.__perf.tasks,
      interactions: window.__perf.interactions,
      supported: window.__perf.supported,
      resources: performance.getEntriesByType('resource').map((entry) => entry.toJSON()),
    }));
    return {
      responses,
      observations,
      metrics: {
        ...vitals,
        firstFrameMs: scenario.player ? vitals.firstFrameMs : null,
        scriptMs: metric('ScriptDuration') * 1000,
        heapBytes: metric('JSHeapUsedSize'),
        jsUsedBytes: coverage.result
          .filter((script) => script.url.startsWith(server.origin))
          .reduce((sum, script) => sum + usedBytes(script.functions), 0),
        requests,
        transferBytes,
      },
      readyAt,
      errors,
      failedRequests,
    };
  } finally {
    if (trace) await context.tracing.stop({ path: join(out, `${profileName}-${scenarioName}.zip`) });
    await context.close();
  }
}

try {
  await seed();
  server = await startServer({
    env: {
      SAMPLE_DIR: join(seedRoot, 'sample'),
      REPLAYS_BETA_EDITOR: 'true',
      EDITING_ENABLED: 'true',
      POSTERS_DISABLED: '1',
      RENDER_DISABLED: '1',
    },
  });
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? process.env.CHROME_PATH;
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--disable-gpu', '--disable-webgl', ...(process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])],
  });
  report.hardware.chromium = browser.version();
  // Pre-generate real 480px JPEG stills from the demo replay, outside timed regions. Measure serving, not rendering.
  const warm = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await warm.addInitScript(observe);
  await warm.goto(`${server.origin}/r/demo-seed-checkout-error`);
  await waitForFrame(warm);
  const poster = await warm.locator('.replayer-wrapper').first().screenshot({ type: 'jpeg', quality: 70 });
  await warm.close();
  // The screenshot is the actual player region; resize via a browser canvas to the server's standard poster width.
  const resize = await browser.newPage();
  const jpeg = await resize.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/jpeg;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = Math.round((image.height * 480) / image.width);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
  }, poster.toString('base64'));
  await resize.close();
  const { POSTER_VERSION, OPEN_STILL_VERSION } = await import('../../src/server/store.ts');
  for (const file of (await readdir(join(seedRoot, 'sample'))).filter((name) => name.endsWith('.json'))) {
    const id = file.replace(/\.json$/, '');
    await mkdir(join(server.dataDir, id), { recursive: true });
    await writeFile(join(server.dataDir, id, `poster.v${POSTER_VERSION}.jpg`), Buffer.from(jpeg, 'base64'));
    await writeFile(join(server.dataDir, id, `open.v${OPEN_STILL_VERSION}.jpg`), Buffer.from(jpeg, 'base64'));
  }
  for (const [name, budget] of Object.entries(config.server)) {
    const rows = [];
    for (const encoding of ['identity', 'gzip', 'br']) {
      for (let index = 0; index < samples; index++) {
        const row = await rawRequest(`${server.origin}${budget.path}`, { 'accept-encoding': encoding });
        if (row.status !== 200) throw new Error(`${name}: expected 200, got ${row.status}`);
        const conditional = row.headers.etag
          ? await rawRequest(`${server.origin}${budget.path}`, { 'accept-encoding': encoding, 'if-none-match': row.headers.etag })
          : null;
        rows.push({ ...row, encoding, conditional });
      }
    }
    report.server[name] = {
      samples: rows,
      byEncoding: Object.fromEntries(
        ['identity', 'gzip', 'br'].map((encoding) => [encoding, summarize(rows.filter((row) => row.encoding === encoding))]),
      ),
      median: summarize(rows.filter((row) => row.encoding === 'br')),
      violations: violations(summarize(rows.filter((row) => row.encoding === 'br')), budget),
    };
  }
  for (const [profileName] of Object.entries(config.profiles)) {
    report.pages[profileName] = {};
    for (const [name, scenario] of Object.entries(config.pages)) {
      // A route can intentionally be absent on the baseline. Never measure the fallback index as comparison.
      if (scenario.feature === 'comparison') {
        const probe = await browser.newPage();
        await probe.goto(`${server.origin}${scenario.path}`);
        const available = await probe
          .locator('.cmp-workspace')
          .waitFor({ timeout: 5000 })
          .then(
            () => true,
            () => false,
          );
        await probe.close();
        if (!available) {
          report.pages[profileName][name] = { unavailable: 'comparison route not shipped in this revision' };
          continue;
        }
      }
      const rows = [];
      for (let index = 0; index < samples; index++) {
        try {
          const row = await measurePage(profileName, name, scenario, index);
          if (row.errors.length || row.failedRequests.length)
            throw new Error(JSON.stringify({ errors: row.errors, failedRequests: row.failedRequests }));
          for (const key of [
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
            ...(scenario.player ? ['firstFrameMs'] : []),
          ]) {
            if (!Number.isFinite(row.metrics[key])) throw new Error(`missing required metric: ${key}`);
          }
          rows.push(row);
        } catch (error) {
          const message = `${profileName}/${name}/${index}: ${error.message}`;
          console.error(message);
          report.errors.push(message);
        }
      }
      report.pages[profileName][name] = {
        samples: rows,
        median: summarize(rows),
        violations: violations(summarize(rows), config.budgets[profileName]),
      };
      console.log(`${profileName}/${name}: ${JSON.stringify(report.pages[profileName][name].median)}`);
    }
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
} else if (
  config.mode === 'enforce' &&
  (Object.values(report.pages).some((pages) => Object.values(pages).some((page) => page.unavailable || page.violations?.length)) ||
    Object.values(report.server).some((endpoint) => endpoint.violations?.length))
)
  process.exitCode = 1;
