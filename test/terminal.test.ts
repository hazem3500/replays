import { describe, expect, it } from 'vitest';

import { createTerminal, failureHint, isFancy, reportCliFailure, supportsHyperlinks, terminalTheme } from '../src/capture/terminal.ts';

const tty = () => {
  const writes: string[] = [];
  return { isTTY: true, write: (text: string) => writes.push(text), writes };
};
const pipe = () => {
  const writes: string[] = [];
  return { isTTY: false, write: (text: string) => writes.push(text), writes };
};

describe('when the terminal is decorated', () => {
  it('is for a TTY with no opt-out', () => {
    expect(isFancy({ env: {}, stream: tty() })).toBe(true);
    expect(isFancy({ env: { CI: 'false', NO_COLOR: '' }, stream: tty() })).toBe(true);
  });

  it.each([
    ['a pipe', {}, pipe(), false],
    ['NO_COLOR', { NO_COLOR: '1' }, tty(), false],
    ['CI', { CI: 'true' }, tty(), false],
    ['TERM=dumb', { TERM: 'dumb' }, tty(), false],
    ['--json', {}, tty(), true],
  ])('is plain for %s', (_name, env, stream, json) => {
    expect(isFancy({ env, stream, json })).toBe(false);
  });

  it('adds no escape codes, spinner frames or links when plain', () => {
    const stream = pipe();
    const term = createTerminal({ env: { FORCE_HYPERLINK: '1' }, stream });
    expect(term.bold('x')).toBe('x');
    expect(term.header()).toBe('◆ Replays');
    expect(term.link('https://example.test/r/1', 'label')).toBe('https://example.test/r/1');
    const spinner = term.spinner('Working');
    spinner.succeed('done');
    expect(stream.writes).toEqual([]);
  });
});

describe('the branded header', () => {
  it('uses the dark accent #e57cd8 and, on a light background, #a23b91', () => {
    const dark = createTerminal({ env: { COLORTERM: 'truecolor' }, stream: tty() });
    const light = createTerminal({ env: { COLORTERM: 'truecolor', COLORFGBG: '0;15' }, stream: tty() });
    expect(dark.header()).toContain('38;2;229;124;216');
    expect(light.header()).toContain('38;2;162;59;145');
    expect(terminalTheme({ COLORFGBG: '15;0' })).toBe('dark');
    expect(terminalTheme({})).toBe('dark');
  });

  it('falls back to 256 and 16 colours', () => {
    expect(createTerminal({ env: { TERM: 'xterm-256color' }, stream: tty() }).accent('x')).toContain('38;5;176');
    expect(createTerminal({ env: { TERM: 'xterm' }, stream: tty() }).accent('x')).toContain('\x1b[35m');
  });
});

describe('links, columns and spinners', () => {
  it('links with OSC 8 only where the terminal supports it', () => {
    const url = 'https://example.test/r/1';
    expect(createTerminal({ env: { TERM_PROGRAM: 'iTerm.app' }, stream: tty() }).link(url)).toBe(`\x1b]8;;${url}\x07${url}\x1b]8;;\x07`);
    expect(createTerminal({ env: {}, stream: tty() }).link(url)).toBe(url);
    expect(supportsHyperlinks({ VTE_VERSION: '6800' })).toBe(true);
    expect(supportsHyperlinks({ VTE_VERSION: '4000' })).toBe(false);
  });

  it('aligns key/value and name/description rows', () => {
    const term = createTerminal({ env: {}, stream: pipe() });
    expect(
      term.keyValue([
        ['Server', 'a'],
        ['Account', 'b'],
      ]),
    ).toBe('  Server   a\n  Account  b');
    expect(
      term.columns([
        ['capture', 'record'],
        ['doctor', 'check'],
      ]),
    ).toBe('  capture  record\n  doctor   check');
  });

  it('draws on a TTY and clears itself when it stops', () => {
    const stream = tty();
    const spinner = createTerminal({ env: {}, stream }).spinner('Working');
    spinner.stop();
    expect(stream.writes.join('')).toContain('Working');
    expect(stream.writes.at(-1)).toBe('\x1b[?25h');
  });
});

describe('failures', () => {
  it('prints one JSON line with the hint and keeps the exit code when plain', () => {
    const stream = pipe();
    const error = Object.assign(new Error('sign in is required for https://x.test; run `replays login` in an interactive terminal'), {
      exitCode: 3,
    });
    expect(reportCliFailure(error, { env: {}, stream })).toBe(3);
    const text = stream.writes.join('');
    expect(text).toContain('"success":false');
    expect(text).toContain('sign in is required');
    expect(text).toContain('"hint":"Run `replays login`');
  });

  it('leaves the hint out when there is none, and defaults to exit code 1', () => {
    const stream = pipe();
    expect(reportCliFailure(new Error('--url must use https'), { env: {}, stream })).toBe(1);
    expect(JSON.parse(stream.writes.join(''))).toEqual({ success: false, error: '--url must use https' });
  });

  it('stays JSON under --json even at a terminal, and styled otherwise', () => {
    const json = tty();
    reportCliFailure(new Error('could not reach configured server https://x.test'), { env: {}, stream: json, json: true });
    expect(json.writes.join('')).toContain('"success":false');
    const human = tty();
    reportCliFailure(new Error('could not reach configured server https://x.test'), { env: {}, stream: human });
    expect(human.writes.join('')).toContain('✗');
    expect(human.writes.join('')).toContain('→ Check the server address');
  });

  it.each([
    ['server refused replay upload (403); verify', 'allow this account'],
    ['replay upload failed (503)', 'try again'],
    ['server check was redirected; configure', 'replays connect'],
  ])('suggests a fix for %s', (message, fix) => {
    expect(failureHint(message)).toContain(fix);
  });
});
