import { resolve } from 'node:path';
import { runtimeBudgets as config } from '../../budgets/runtime.mjs';

function parseServerEnv(raw) {
  const value = JSON.parse(raw ?? '{}');
  const isObject = Boolean(value) && !Array.isArray(value) && typeof value === 'object';
  if (!isObject || Object.values(value).some((item) => typeof item !== 'string')) {
    throw new Error('PERF_SERVER_ENV must be a JSON object of string environment values');
  }
  return value;
}

function parseTiles(raw) {
  const tiles = (raw ?? '').split(',').filter(Boolean).map(Number);
  if (tiles.some((count) => !Number.isInteger(count) || count < 2 || count > 9)) {
    throw new Error('PERF_COMPARE_TILES must contain tile counts from 2 through 9');
  }
  return tiles;
}

function parsePlaybackMs(raw) {
  const playbackMs = Number(raw ?? config.playbackMs);
  if (!Number.isFinite(playbackMs) || playbackMs < 500) throw new Error('PERF_PLAYBACK_MS must be >= 500');
  return playbackMs;
}

function parseProfiles(raw) {
  const profiles = raw?.split(',');
  if (profiles?.some((profile) => !config.profiles[profile])) throw new Error('PERF_PROFILES contains an unknown profile');
  return profiles;
}

function parseSeedRows(raw, ssrGate, compareTiles) {
  const fallback = ssrGate ? config.ssrGate.indexRows : 6;
  const seedRows = Math.max(...compareTiles, Number(raw ?? fallback));
  if (!Number.isInteger(seedRows) || seedRows < 6) throw new Error('PERF_INDEX_ROWS must be an integer >= 6');
  return seedRows;
}

function parseSamples(raw) {
  const samples = Number(raw ?? config.samples);
  if (!Number.isInteger(samples) || samples < 1) throw new Error('PERF_SAMPLES must be a positive integer');
  return samples;
}

/** Validated runner settings from PERF_* environment variables, with budgets/runtime.mjs as the defaults. */
export function readSettings(env = process.env) {
  const serverEnv = parseServerEnv(env.PERF_SERVER_ENV);
  const ssrGate = env.PERF_SSR_GATE === '1';
  const compareTiles = parseTiles(env.PERF_COMPARE_TILES);
  const basePath = (serverEnv.BASE_PATH ?? '').split('/').filter(Boolean).join('/');
  return {
    out: resolve(env.PERF_OUTPUT ?? '.review-artifacts/perf/current'),
    samples: parseSamples(env.PERF_SAMPLES),
    serverEnv,
    prefix: basePath ? `/${basePath}` : '',
    ssrGate,
    compareTiles,
    playbackMs: parsePlaybackMs(env.PERF_PLAYBACK_MS),
    selectedPages: env.PERF_PAGES?.split(','),
    selectedProfiles: parseProfiles(env.PERF_PROFILES),
    seedRows: parseSeedRows(env.PERF_INDEX_ROWS, ssrGate, compareTiles),
  };
}
