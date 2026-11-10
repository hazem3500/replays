import { describe, expect, it } from 'vitest';

import { findFfmpeg, findSystemBrowser, hasPlaywrightBrowser, type ToolHost } from '../src/capture/drivers/system-tools.ts';
import { commandHelp } from '../src/command-help.ts';

const host = (platform: NodeJS.Platform, files: string[] = [], dirs: Record<string, string[]> = {}): ToolHost => ({
  platform,
  home: '/home/u',
  executable: (file) => files.includes(file),
  list: (directory) => dirs[directory] ?? [],
});

describe('system browser and ffmpeg detection', () => {
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

  it('finds Chrome on macOS, Linux PATH and Windows', () => {
    expect(findSystemBrowser({}, host('darwin', [mac]))).toBe(mac);
    expect(findSystemBrowser({ PATH: '/a:/usr/bin' }, host('linux', ['/usr/bin/chromium']))).toBe('/usr/bin/chromium');
    const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    expect(findSystemBrowser({ 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)' }, host('win32', [edge]))).toBe(edge);
    expect(findSystemBrowser({ PATH: '/a' }, host('linux'))).toBeUndefined();
  });

  it('finds ffmpeg on PATH, then in Homebrew folders', () => {
    expect(findFfmpeg({ PATH: '/x' }, host('linux', ['/x/ffmpeg']))).toBe('/x/ffmpeg');
    expect(findFfmpeg({ PATH: '/x' }, host('darwin', ['/opt/homebrew/bin/ffmpeg']))).toBe('/opt/homebrew/bin/ffmpeg');
    expect(findFfmpeg({ PATH: '/x' }, host('linux'))).toBeUndefined();
  });

  it("knows whether Playwright's Chromium is downloaded", () => {
    const cache = '/home/u/.cache/ms-playwright';
    expect(hasPlaywrightBrowser({}, host('linux', [], { [cache]: ['chromium-1200'] }))).toBe(true);
    expect(hasPlaywrightBrowser({}, host('linux'))).toBe(false);
  });
});

describe('per-command help', () => {
  it('returns usage for commands without their own help and never for plain runs', () => {
    for (const command of ['import', 'upload', 'login', 'status', 'logout', 'serve'])
      expect(commandHelp(command, ['--help'])).toContain(`replays ${command}`);
    expect(commandHelp('serve', ['-h'])).toContain('replays serve');
    expect(commandHelp('serve', [])).toBeUndefined();
    expect(commandHelp('capture', ['--help'])).toBeUndefined();
    expect(commandHelp('constructor', ['--help'])).toBeUndefined();
  });
});
