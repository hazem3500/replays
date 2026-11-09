import { findFfmpeg, findSystemBrowser, hasPlaywrightBrowser } from './drivers/system-tools.ts';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  id: 'node' | 'server' | 'sign-in' | 'chrome' | 'ffmpeg';
  status: CheckStatus;
  detail: string;
  fix?: string;
}

/** Node versions the CLI supports: capture and upload from 22.12, `serve` from 22.22, 24.11 and 26. */
export function checkNode(version: string = process.versions.node): DoctorCheck {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  const supported = major >= 26 || (major === 24 && minor >= 11) || (major === 22 && minor >= 22);
  if (supported) return { id: 'node', status: 'ok', detail: `Node ${version}` };
  if (major === 22 && minor >= 12)
    return { id: 'node', status: 'warn', detail: `Node ${version}`, fix: 'Capture and upload work; `serve` needs Node 22.22 or newer.' };
  return { id: 'node', status: 'fail', detail: `Node ${version}`, fix: 'Install Node 22.12 or newer (24.11+ recommended).' };
}

export function checkChrome(env: NodeJS.ProcessEnv = process.env): DoctorCheck {
  const explicit = env.CHROME_PATH || env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const found = explicit || findSystemBrowser(env);
  if (found) return { id: 'chrome', status: 'ok', detail: found };
  if (hasPlaywrightBrowser(env)) return { id: 'chrome', status: 'ok', detail: "Playwright's Chromium" };
  return {
    id: 'chrome',
    status: 'warn',
    detail: 'not found',
    fix: 'Install Google Chrome or run `npx playwright install chromium`; set CHROME_PATH to use another browser. Needed for `capture` only.',
  };
}

export function checkFfmpeg(env: NodeJS.ProcessEnv = process.env): DoctorCheck {
  const found = env.FFMPEG_PATH || findFfmpeg(env);
  if (found) return { id: 'ffmpeg', status: 'ok', detail: found };
  return {
    id: 'ffmpeg',
    status: 'warn',
    detail: 'not found',
    fix: 'Install ffmpeg (macOS: brew install ffmpeg; Debian/Ubuntu: sudo apt install ffmpeg) or set FFMPEG_PATH. Needed for `capture --video` only.',
  };
}

export const localChecks = (env: NodeJS.ProcessEnv = process.env): DoctorCheck[] => [checkNode(), checkChrome(env), checkFfmpeg(env)];

export const doctorOutcome = (checks: readonly DoctorCheck[]) => (checks.some((check) => check.status === 'fail') ? 'fail' : 'ok');
