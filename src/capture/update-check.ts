import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { configPath } from './server-config.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1500;
const NOTICE_COMMANDS = new Set(['capture', 'import', 'upload', 'status', 'doctor', 'login']);

export interface UpdateCache {
  checkedAt: number;
  latest?: string;
}

export interface UpdateCheckOptions {
  current: string;
  /** Where the newest version is published; the response is read as `{ "version": "x.y.z" }`. */
  latestUrl: string;
  cachePath: string;
  now?: number;
  intervalMs?: number;
  fetchLatest?: (url: string, signal?: AbortSignal) => Promise<string | undefined>;
  signal?: AbortSignal;
}

export interface UpdateInfo {
  current: string;
  latest: string;
}

export const updateCachePath = (env: NodeJS.ProcessEnv) => join(dirname(configPath(env)), 'update-check.json');

const versionParts = (version: string) =>
  version
    .split('-', 1)
    .join('')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);

/** Numeric `major.minor.patch` comparison; a pre-release suffix is ignored. */
export function isNewer(latest: string, current: string) {
  const [a, b] = [versionParts(latest), versionParts(current)];
  for (let index = 0; index < 3; index++) if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  return false;
}

/** Update notices are for a person at a terminal: stderr is a TTY, and not in CI, JSON mode or when opted out. */
export function shouldCheckForUpdates(env: NodeJS.ProcessEnv, stderrIsTty: boolean, json: boolean) {
  const ci = env.CI !== undefined && env.CI !== '' && env.CI !== '0' && env.CI !== 'false';
  const optedOut = Boolean(env.REPLAYS_NO_UPDATE_CHECK || env.NO_UPDATE_NOTIFIER);
  return stderrIsTty && !json && !ci && !optedOut;
}

async function readCache(path: string): Promise<UpdateCache | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return;
  }
  if (typeof parsed !== 'object' || parsed === null || !('checkedAt' in parsed) || typeof parsed.checkedAt !== 'number') return;
  return { checkedAt: parsed.checkedAt, ...('latest' in parsed && typeof parsed.latest === 'string' ? { latest: parsed.latest } : {}) };
}

async function writeCache(path: string, cache: UpdateCache) {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(cache)}\n`);
  } catch {
    /* why: a read-only config directory must never break a command; the check just repeats next run. */
  }
}

export async function fetchLatestVersion(url: string, signal?: AbortSignal): Promise<string | undefined> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const response = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { accept: 'application/json' },
  });
  if (!response.ok) return;
  const body: unknown = await response.json();
  if (typeof body === 'object' && body !== null && 'version' in body && typeof body.version === 'string') return body.version;
  return;
}

async function lookUp(options: UpdateCheckOptions) {
  try {
    return await (options.fetchLatest ?? fetchLatestVersion)(options.latestUrl, options.signal);
  } catch {
    return;
  }
}

/**
 * The newer version, if any. The registry is asked at most once per interval (a day); in between, the cached answer is
 * used. A failed check is cached as well so an offline machine is not retried on every command.
 */
export async function checkForUpdate(options: UpdateCheckOptions): Promise<UpdateInfo | undefined> {
  const path = options.cachePath;
  const now = options.now ?? Date.now();
  const cached = await readCache(path);
  let latest = cached?.latest;
  if (!cached || now - cached.checkedAt >= (options.intervalMs ?? DAY_MS) || now < cached.checkedAt) {
    latest = await lookUp(options);
    await writeCache(path, { checkedAt: now, ...(latest ? { latest } : {}) });
  }
  if (latest && isNewer(latest, options.current)) return { current: options.current, latest };
  return;
}

export function updateNoticeText(info: UpdateInfo, command?: string) {
  return `Update available: ${info.current} → ${info.latest}.${command ? ` Run \`${command}\` to update.` : ''}`;
}

/**
 * Starts the check in the background and returns a function that yields the notice only if the check already finished,
 * so a command never waits for the network; an unfinished request is cancelled when the notice is read.
 */
export function startUpdateCheck(options: UpdateCheckOptions) {
  const controller = new AbortController();
  let settled: { value: UpdateInfo | undefined } | undefined;
  void checkForUpdate({ ...options, signal: controller.signal }).then(
    (value) => {
      settled = { value };
    },
    () => {
      settled = { value: undefined };
    },
  );
  return () => {
    controller.abort();
    return settled?.value;
  };
}

function ownVersion() {
  for (const path of ['../package.json', '../../package.json']) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
      if (typeof parsed === 'object' && parsed !== null && 'version' in parsed && typeof parsed.version === 'string') return parsed.version;
    } catch {
      continue;
    }
  }
  return;
}

/**
 * The CLI's once-a-day update notice, off unless a distribution points `REPLAYS_UPDATE_URL` at its registry's
 * `latest` document (and optionally `REPLAYS_UPDATE_COMMAND` at its reinstall command). Call the result after the
 * command has finished: it prints to stderr only when the check is already done.
 */
export function startCliUpdateNotice(command: string | undefined, argv: readonly string[], env: NodeJS.ProcessEnv) {
  const latestUrl = env.REPLAYS_UPDATE_URL;
  const current = latestUrl && command && NOTICE_COMMANDS.has(command) ? ownVersion() : undefined;
  if (!latestUrl || !current || !shouldCheckForUpdates(env, Boolean(process.stderr.isTTY), argv.includes('--json'))) return () => {};
  const read = startUpdateCheck({ current, latestUrl, cachePath: updateCachePath(env) });
  return () => {
    const info = read();
    if (info) process.stderr.write(`\n${updateNoticeText(info, env.REPLAYS_UPDATE_COMMAND)}\n`);
  };
}
