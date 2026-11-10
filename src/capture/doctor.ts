import { existsSync } from 'node:fs';

import type { Terminal } from './terminal.ts';
import { findFfmpeg, findSystemBrowser, hasPlaywrightBrowser } from './drivers/system-tools.ts';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  id: 'node' | 'serve' | 'server' | 'sign-in' | 'chrome' | 'ffmpeg';
  status: CheckStatus;
  detail: string;
  fix?: string;
}

const parseNode = (version: string) => {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return { major, minor };
};

/** `capture` and `upload` run from Node 22.12; a version below that fails the check. */
export function checkNode(version: string = process.versions.node): DoctorCheck {
  const { major, minor } = parseNode(version);
  if (major > 22 || (major === 22 && minor >= 12)) return { id: 'node', status: 'ok', detail: `(Node ${version})` };
  return {
    id: 'node',
    status: 'fail',
    detail: `needs Node 22.12+ (found ${version})`,
    fix: 'Install Node 22.12 or newer (24.11+ recommended).',
  };
}

/** `serve` needs Node 22.22, 24.11 or 26. Too old is a warning: it blocks `serve` only, never capture or upload. */
export function checkServe(version: string = process.versions.node): DoctorCheck {
  const { major, minor } = parseNode(version);
  if (major >= 26 || (major === 24 && minor >= 11) || (major === 22 && minor >= 22))
    return { id: 'serve', status: 'ok', detail: `(Node ${version})` };
  return {
    id: 'serve',
    status: 'warn',
    detail: 'needs Node 22.22+',
    fix: `Only \`serve\` is affected; capture and upload work on Node ${version}. Install Node 22.22 or newer to run \`serve\`.`,
  };
}

const unset = (value: string | undefined) => (value === '' ? undefined : value);

const staleCheck = (id: 'chrome' | 'ffmpeg', variable: string, path: string): DoctorCheck => ({
  id,
  status: 'warn',
  detail: `${path} does not exist`,
  fix: `Fix ${variable} or unset it so the tool is found automatically.`,
});

export function checkChrome(env: NodeJS.ProcessEnv, exists: (path: string) => boolean = existsSync): DoctorCheck {
  const explicit = unset(env.CHROME_PATH) ?? unset(env.PLAYWRIGHT_CHROMIUM_EXECUTABLE);
  if (explicit && !exists(explicit))
    return staleCheck('chrome', unset(env.CHROME_PATH) ? 'CHROME_PATH' : 'PLAYWRIGHT_CHROMIUM_EXECUTABLE', explicit);
  const found = explicit ?? findSystemBrowser(env);
  if (found) return { id: 'chrome', status: 'ok', detail: found };
  if (hasPlaywrightBrowser(env)) return { id: 'chrome', status: 'ok', detail: "Playwright's Chromium" };
  return {
    id: 'chrome',
    status: 'warn',
    detail: 'not found',
    fix: 'Install Google Chrome or run `npx playwright install chromium`; set CHROME_PATH to use another browser. Needed for `capture` only.',
  };
}

export function checkFfmpeg(env: NodeJS.ProcessEnv, exists: (path: string) => boolean = existsSync): DoctorCheck {
  const explicit = unset(env.FFMPEG_PATH);
  if (explicit && !exists(explicit)) return staleCheck('ffmpeg', 'FFMPEG_PATH', explicit);
  const found = explicit ?? findFfmpeg(env);
  if (found) return { id: 'ffmpeg', status: 'ok', detail: found };
  return {
    id: 'ffmpeg',
    status: 'warn',
    detail: 'not found',
    fix: 'Install ffmpeg (macOS: brew install ffmpeg; Debian/Ubuntu: sudo apt install ffmpeg) or set FFMPEG_PATH. Needed for `capture --video` only.',
  };
}

export const localChecks = (env: NodeJS.ProcessEnv): DoctorCheck[] => [checkNode(), checkServe(), checkChrome(env), checkFfmpeg(env)];

export const doctorOutcome = (checks: readonly DoctorCheck[]) => (checks.some((check) => check.status === 'fail') ? 'fail' : 'ok');

const CHECK_LABELS: Record<DoctorCheck['id'], string> = {
  node: 'capture/upload',
  serve: 'serve',
  chrome: 'Chrome',
  ffmpeg: 'ffmpeg',
  server: 'Server',
  'sign-in': 'Sign-in',
};

const CHECK_MARKS = { ok: 'ok', warn: 'warn', fail: 'failed' } as const;

export const doctorLabel = (check: Pick<DoctorCheck, 'id'>) => CHECK_LABELS[check.id];

/** One row per check. A `serve` that cannot run on this Node reads as unavailable (✗) though it is only a warning: capture and upload still work. */
export function doctorRows(checks: readonly DoctorCheck[], out: Pick<Terminal, 'ok' | 'warn' | 'failed'>): Array<[string, string]> {
  return checks.map((check) => {
    const mark = check.id === 'serve' && check.status === 'warn' ? 'failed' : CHECK_MARKS[check.status];
    return [doctorLabel(check), out[mark](check.detail)];
  });
}
