import { accessSync, constants, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

export interface ToolHost {
  platform: NodeJS.Platform;
  home: string;
  executable(file: string): boolean;
  list(directory: string): string[];
}

const BROWSER_COMMANDS = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'microsoft-edge',
  'microsoft-edge-stable',
];
const MAC_BROWSERS = [
  'Google Chrome.app/Contents/MacOS/Google Chrome',
  'Chromium.app/Contents/MacOS/Chromium',
  'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];
const WINDOWS_BROWSERS = [
  'Google\\Chrome\\Application\\chrome.exe',
  'Chromium\\Application\\chrome.exe',
  'Microsoft\\Edge\\Application\\msedge.exe',
];
const FFMPEG_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];

const systemHost: ToolHost = {
  platform: process.platform,
  home: homedir(),
  executable(file) {
    try {
      accessSync(file, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
  list(directory) {
    try {
      return readdirSync(directory);
    } catch {
      return [];
    }
  },
};

const pathFor = (host: ToolHost) => (host.platform === 'win32' ? win32 : posix);

function onPath(names: string[], env: NodeJS.ProcessEnv, host: ToolHost): string | undefined {
  const { delimiter, join } = pathFor(host);
  for (const directory of (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean))
    for (const name of names) {
      const file = join(directory, name);
      if (host.executable(file)) return file;
    }
  return undefined;
}

/** An installed Chrome, Chromium or Edge: the standard macOS and Windows locations, or a browser command on PATH. */
export function findSystemBrowser(env: NodeJS.ProcessEnv = process.env, host: ToolHost = systemHost): string | undefined {
  const { join } = pathFor(host);
  if (host.platform === 'darwin')
    return ['/Applications', join(host.home, 'Applications')]
      .flatMap((root) => MAC_BROWSERS.map((app) => join(root, app)))
      .find((file) => host.executable(file));
  if (host.platform === 'win32')
    return [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]
      .filter((root): root is string => Boolean(root))
      .flatMap((root) => WINDOWS_BROWSERS.map((app) => join(root, app)))
      .find((file) => host.executable(file));
  return onPath(BROWSER_COMMANDS, env, host);
}

/** `ffmpeg` on PATH, else Homebrew's and the usual system folders (a GUI-launched PATH often lacks them). */
export function findFfmpeg(env: NodeJS.ProcessEnv = process.env, host: ToolHost = systemHost): string | undefined {
  const { join } = pathFor(host);
  const name = host.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  return (
    onPath([name], env, host) ??
    (host.platform === 'win32' ? undefined : FFMPEG_DIRS.map((directory) => join(directory, name)).find((file) => host.executable(file)))
  );
}

/** Whether Playwright's own Chromium has been downloaded (`npx playwright install chromium`). */
export function hasPlaywrightBrowser(env: NodeJS.ProcessEnv = process.env, host: ToolHost = systemHost): boolean {
  if (env.PLAYWRIGHT_BROWSERS_PATH === '0') return true;
  const { join } = pathFor(host);
  const cache =
    env.PLAYWRIGHT_BROWSERS_PATH ||
    (host.platform === 'darwin'
      ? join(host.home, 'Library', 'Caches', 'ms-playwright')
      : host.platform === 'win32'
        ? join(env.LOCALAPPDATA ?? join(host.home, 'AppData', 'Local'), 'ms-playwright')
        : join(host.home, '.cache', 'ms-playwright'));
  return host.list(cache).some((name) => name.startsWith('chromium'));
}

export const NO_BROWSER_MESSAGE =
  'No Chrome, Chromium or Edge found for capture. Install Google Chrome (https://www.google.com/chrome) or run `npx playwright install chromium`, or set CHROME_PATH to a browser executable.';
export const NO_FFMPEG_MESSAGE =
  '--video needs ffmpeg, which was not found. Install it (macOS: brew install ffmpeg; Debian/Ubuntu: sudo apt install ffmpeg; Windows: winget install ffmpeg) or set FFMPEG_PATH to the ffmpeg executable.';
