import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runtimeBudgets as config } from '../../budgets/runtime.mjs';
import { observe } from './observe.mjs';
import { percentile, usedBytes } from './model.mjs';

const HYDRATION_MESSAGE = /hydrat|server.rendered|#418|#423|#425/i;
const PLAY_BUTTON = /^(Play|Play the result|Play both recordings|Play all recordings|Play comparison|Replay from start)$/;
const PAUSE_BUTTON = /^(Pause|Pause both recordings|Pause all recordings|Pause comparison)$/;

export async function waitForFrame(page) {
  await page.waitForFunction(() => window.__perf.firstFrameMs !== null, { timeout: 30_000 });
}

const taskDuration = (metrics) => metrics.metrics.find((metric) => metric.name === 'TaskDuration')?.value;

async function startFrameProbe(page) {
  await page.evaluate(() => {
    window.__playback = { start: performance.now(), previous: null, gaps: [], running: true };
    const tick = (at) => {
      const state = window.__playback;
      if (!state.running) return;
      if (state.previous !== null) state.gaps.push(at - state.previous);
      state.previous = at;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopFrameProbe(page) {
  const frames = await page.evaluate(() => {
    window.__playback.running = false;
    return { ...window.__playback, elapsedMs: performance.now() - window.__playback.start };
  });
  const tasks = await page.evaluate((start) => {
    window.__flushPerf();
    return window.__perf.tasks.filter((task) => task.start + task.duration >= start);
  }, frames.start);
  return { frames, tasks };
}

async function playbackInteraction(page, cdp, playbackMs) {
  await waitForFrame(page);
  await page.getByRole('button', { name: PLAY_BUTTON }).first().click();
  const before = await cdp.send('Performance.getMetrics');
  await startFrameProbe(page);
  await page.waitForTimeout(playbackMs);
  const after = await cdp.send('Performance.getMetrics');
  const { frames, tasks } = await stopFrameProbe(page);
  await page.getByRole('button', { name: PAUSE_BUTTON }).first().click();
  return {
    frameTimeP95Ms: percentile(frames.gaps, 0.95),
    mainThreadBusyPct: Math.min(100, ((taskDuration(after) - taskDuration(before)) * 100_000) / frames.elapsedMs),
    playbackLongTasks: tasks.length,
    playbackElapsedMs: frames.elapsedMs,
    playbackFrameSamples: frames.gaps.length,
  };
}

/** Phones open Settings from the index header's menu sheet; wider screens have the Settings button. */
async function openSettings(page) {
  const menu = page.getByRole('button', { name: 'Menu' });
  if (await menu.isVisible()) {
    await menu.click();
    await page.getByRole('button', { name: /^Settings/ }).click();
  } else await page.getByRole('button', { name: 'Settings', exact: true }).click();
}

async function settingsInteraction(page) {
  await openSettings(page);
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.waitFor();
  // why: desktop shows the sections as tabs, phones as a list that pushes one section; both carry the slot markup.
  await dialog.locator('[data-slot="settings.sections"] [data-slot-item]').last().click();
}

async function indexInteraction(page) {
  const search = page.getByRole('searchbox');
  if (await search.count()) {
    await search.fill('checkout');
    await search.press('Enter');
    await search.fill('');
    return;
  }
  await openSettings(page);
  await page.keyboard.press('Escape');
}

async function interaction(page, scenario, cdp, playbackMs) {
  let playback = {};
  if (scenario.player) playback = await playbackInteraction(page, cdp, playbackMs);
  else if (scenario.settings) await settingsInteraction(page);
  else await indexInteraction(page);
  // why: Event Timing and long-task observers deliver after the last interaction.
  await page.waitForTimeout(300);
  return playback;
}

async function throttle(cdp, profile, trace) {
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
}

function collectEvents(page, cdp) {
  const events = { requests: 0, transferBytes: 0, failedRequests: [], responses: [], errors: [], hydrationErrors: [] };
  cdp.on('Network.responseReceived', ({ response }) =>
    events.responses.push({ url: response.url, status: response.status, mimeType: response.mimeType, timing: response.timing }),
  );
  cdp.on('Network.requestWillBeSent', (event) => {
    if (/^https?:/.test(event.request.url)) events.requests++;
  });
  cdp.on('Network.loadingFinished', (event) => {
    events.transferBytes += event.encodedDataLength;
  });
  cdp.on('Network.loadingFailed', (event) => {
    if (!event.canceled) events.failedRequests.push(event.errorText);
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && HYDRATION_MESSAGE.test(message.text())) events.hydrationErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    events.errors.push(error.message);
    if (HYDRATION_MESSAGE.test(error.message)) events.hydrationErrors.push(error.message);
  });
  return events;
}

function readVitals(page, readyAt) {
  return page.evaluate((observationEnd) => {
    window.__flushPerf();
    const state = window.__perf;
    const navigation = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
    const durations = Object.values(state.interactions).sort((a, b) => b - a);
    // why: INP is the p98 interaction latency; a short scripted run uses its worst observed interaction.
    const inpMs = durations[Math.floor(durations.length / 50)] ?? null;
    const longTasks = state.supported.includes('longtask');
    return {
      lcpMs: state.lcpMs,
      fcpMs: fcp || null,
      firstReplayTitleMs: state.firstReplayTitleMs,
      contentReadyMs: state.firstFrameMs ?? state.firstReplayTitleMs,
      cls: state.supported.includes('layout-shift') ? state.cls : null,
      inpMs,
      ttfbMs: navigation.responseStart - navigation.startTime,
      tbtMs: longTasks
        ? state.tasks.reduce(
            (sum, task) => sum + Math.max(0, Math.min(task.start + task.duration, observationEnd) - Math.max(task.start + 50, fcp)),
            0,
          )
        : null,
      longTasks: longTasks ? state.tasks.length : null,
      firstFrameMs: state.firstFrameMs,
    };
  }, readyAt);
}

function readObservations(page) {
  return page.evaluate(() => ({
    tasks: window.__perf.tasks,
    interactions: window.__perf.interactions,
    supported: window.__perf.supported,
    frameGapsMs: window.__playback?.gaps,
    resources: performance.getEntriesByType('resource').map((entry) => entry.toJSON()),
  }));
}

async function openScenario(context, scenario) {
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.addInitScript(observe, { player: Boolean(scenario.player), title: !scenario.player });
  await page.addInitScript((view) => localStorage.setItem('replays-index-view', view), scenario.view ?? 'list');
  const cdp = await context.newCDPSession(page);
  return { page, cdp };
}

async function navigate({ page }, scenario, url) {
  await page.goto(url, { waitUntil: 'load' });
  await page.locator(scenario.ready).first().waitFor();
  if (scenario.player) await waitForFrame(page);
  await page.waitForTimeout(config.settleMs);
  return page.evaluate(() => performance.now());
}

async function finishMeasurement({ ctx, scenario, opened, events, vitals, playback, prefix }) {
  const { cdp, page } = opened;
  const coverage = await cdp.send('Profiler.takePreciseCoverage');
  const metrics = await cdp.send('Performance.getMetrics');
  const metric = (name) => metrics.metrics.find((item) => item.name === name)?.value ?? null;
  const observations = await readObservations(page);
  return {
    responses: events.responses,
    observations,
    metrics: {
      ...vitals,
      ...playback,
      requestedTiles: scenario.tiles ?? (scenario.player ? 1 : null),
      hydrationErrors: events.hydrationErrors.length,
      hydrationRefetches: events.responses.filter((response) => new URL(response.url).pathname === `${prefix}/api/replays`).length,
      firstFrameMs: scenario.player ? vitals.firstFrameMs : null,
      scriptMs: metric('ScriptDuration') * 1000,
      heapBytes: metric('JSHeapUsedSize'),
      jsUsedBytes: coverage.result
        .filter((script) => script.url.startsWith(ctx.server.origin))
        .reduce((sum, script) => sum + usedBytes(script.functions), 0),
      requests: events.requests,
      transferBytes: events.transferBytes,
    },
  };
}

/**
 * One cold-cache visit to a scenario under a throttling profile. The first sample of each scenario also
 * records a Playwright trace and a V8 CPU profile.
 */
export async function measurePage(ctx, { profileName, scenarioName, scenario, index }) {
  const { browser, server, settings } = ctx;
  const profile = config.profiles[profileName];
  const context = await browser.newContext({
    viewport: scenario.wide ? config.profiles.desktop.viewport : profile.viewport,
    deviceScaleFactor: 1,
  });
  const trace = index === 0;
  if (trace) await context.tracing.start({ screenshots: false, snapshots: false, sources: false });
  const url = `${server.origin}${settings.prefix}${scenario.path}`;
  const opened = await openScenario(context, scenario);
  const events = collectEvents(opened.page, opened.cdp);
  try {
    await throttle(opened.cdp, profile, trace);
    const readyAt = await navigate(opened, scenario, url);
    const playback = await interaction(opened.page, scenario, opened.cdp, settings.playbackMs);
    const vitals = await readVitals(opened.page, readyAt);
    if (trace) {
      const { profile: cpuProfile } = await opened.cdp.send('Profiler.stop');
      await writeFile(join(settings.out, `${profileName}-${scenarioName}.cpuprofile`), JSON.stringify(cpuProfile));
    }
    const result = await finishMeasurement({ ctx, scenario, opened, events, vitals, playback, prefix: settings.prefix });
    return { ...result, readyAt, errors: events.errors, failedRequests: events.failedRequests };
  } finally {
    if (trace) await context.tracing.stop({ path: join(settings.out, `${profileName}-${scenarioName}.zip`) });
    await context.close();
  }
}
