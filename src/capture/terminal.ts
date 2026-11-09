import { PRODUCT_NAME } from '../shared/brand.ts';

/** Accent colours of the Replays brand: pink on dark terminals, deeper pink on light ones. */
const ACCENT = { dark: [0xe5, 0x7c, 0xd8], light: [0xa2, 0x3b, 0x91] } as const;
const ACCENT_256 = { dark: 176, light: 127 } as const;
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const HYPERLINK_PROGRAMS = new Set(['iTerm.app', 'WezTerm', 'vscode', 'ghostty', 'Hyper']);

export interface TerminalStream {
  isTTY?: boolean;
  write(text: string): unknown;
}

export interface TerminalOptions {
  env: NodeJS.ProcessEnv;
  stream: TerminalStream;
  /** `--json` was given: never decorate. */
  json?: boolean;
}

export interface Spinner {
  update(text: string): void;
  succeed(text: string): void;
  fail(text: string): void;
  stop(): void;
}

/** Colour, spinners and links only for a person at a terminal; never for pipes, CI, NO_COLOR, TERM=dumb or `--json`. */
export function isFancy({ env, stream, json = false }: TerminalOptions) {
  const ci = env.CI !== undefined && env.CI !== '' && env.CI !== '0' && env.CI !== 'false';
  const noColor = env.NO_COLOR !== undefined && env.NO_COLOR !== '';
  return Boolean(stream.isTTY) && !json && !ci && !noColor && env.TERM !== 'dumb';
}

export function supportsHyperlinks(env: NodeJS.ProcessEnv) {
  if (env.FORCE_HYPERLINK !== undefined) return env.FORCE_HYPERLINK !== '0';
  if (env.WT_SESSION || env.KITTY_WINDOW_ID || env.WEZTERM_EXECUTABLE) return true;
  if (env.TERM_PROGRAM && HYPERLINK_PROGRAMS.has(env.TERM_PROGRAM)) return true;
  return Number(env.VTE_VERSION) >= 5000;
}

/** Light when COLORFGBG reports a light background (7 or 15); dark otherwise, which is the common default. */
export function terminalTheme(env: NodeJS.ProcessEnv): 'dark' | 'light' {
  const background = env.COLORFGBG?.split(';').at(-1);
  return background === '7' || background === '15' ? 'light' : 'dark';
}

function accentSequence(env: NodeJS.ProcessEnv, theme: 'dark' | 'light') {
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') return `38;2;${ACCENT[theme].join(';')}`;
  return /256/.test(env.TERM ?? '') ? `38;5;${ACCENT_256[theme]}` : '35';
}

export function createTerminal(options: TerminalOptions) {
  const { env, stream } = options;
  const fancy = isFancy(options);
  const theme = terminalTheme(env);
  const wrap = (open: string, close: string) => (text: string) => (fancy ? `\x1b[${open}m${text}\x1b[${close}m` : text);
  const accentCode = accentSequence(env, theme);

  const bold = wrap('1', '22');
  const dim = wrap('2', '22');
  const accent = wrap(accentCode, '39');
  const green = wrap('32', '39');
  const red = wrap('31', '39');
  const yellow = wrap('33', '39');
  const hyperlinks = fancy && supportsHyperlinks(env);

  return {
    fancy,
    bold,
    dim,
    accent,
    green,
    red,
    yellow,
    header: () => `${accent('◆')} ${bold(PRODUCT_NAME.charAt(0).toUpperCase() + PRODUCT_NAME.slice(1))}`,
    link: (url: string, label = url) => (hyperlinks ? `\x1b]8;;${url}\x07${label}\x1b]8;;\x07` : url),
    ok: (text: string) => `${green('✓')} ${text}`,
    failed: (text: string) => `${red('✗')} ${text}`,
    warn: (text: string) => `${yellow('!')} ${text}`,
    keyValue(rows: ReadonlyArray<readonly [string, string]>, indent = 2) {
      const width = Math.max(0, ...rows.map(([label]) => label.length));
      return rows.map(([label, value]) => `${' '.repeat(indent)}${dim(label.padEnd(width))}  ${value}`).join('\n');
    },
    columns(rows: ReadonlyArray<readonly [string, string]>, indent = 2) {
      const width = Math.max(0, ...rows.map(([name]) => name.length));
      return rows.map(([name, text]) => `${' '.repeat(indent)}${bold(name)}${' '.repeat(width - name.length + 2)}${dim(text)}`).join('\n');
    },
    spinner(text: string): Spinner {
      if (!fancy) return { update() {}, succeed() {}, fail() {}, stop() {} };
      let label = text;
      let frame = 0;
      const clear = '\r\x1b[2K';
      const draw = () => stream.write(`${clear}${accent(SPINNER_FRAMES[frame++ % SPINNER_FRAMES.length] ?? '')} ${label}`);
      const restore = () => stream.write('\x1b[?25h');
      stream.write('\x1b[?25l');
      process.once('exit', restore);
      draw();
      const timer = setInterval(draw, 80);
      timer.unref();
      const finish = (line?: string) => {
        clearInterval(timer);
        process.off('exit', restore);
        stream.write(`${clear}${line === undefined ? '' : `${line}\n`}`);
        restore();
      };
      return {
        update: (next) => {
          label = next;
        },
        succeed: (done) => finish(`${green('✓')} ${done}`),
        fail: (failed) => finish(`${red('✗')} ${failed}`),
        stop: () => finish(),
      };
    },
  };
}

export type Terminal = ReturnType<typeof createTerminal>;

const HINTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/sign in is required|run `replays login/i, 'Run `replays login` in an interactive terminal, then try again.'],
  [/could not reach/i, 'Check the server address (`replays config`) and your network connection.'],
  [/\(403\)/, 'Ask the deployment owner to allow this account to upload replays.'],
  [/failed \(5\d\d\)/, 'The server had a problem; try again in a moment.'],
  [/was redirected/, 'Save the final server address with `replays connect <url>`.'],
];

/** A one-line fix for the failures people hit most, or nothing when there is no useful advice. */
export function failureHint(message: string) {
  return HINTS.find(([pattern]) => pattern.test(message))?.[1];
}

/** Reports a failed command: one JSON line on stderr for agents and pipes, a short styled message for people. Returns the exit code. */
export function reportCliFailure(error: unknown, options: TerminalOptions) {
  const message = error instanceof Error ? error.message : String(error);
  const hint = failureHint(message);
  const { stream } = options;
  const term = createTerminal(options);
  if (term.fancy) stream.write(`\n${term.failed(message)}${hint ? `\n  ${term.dim(`→ ${hint}`)}` : ''}\n`);
  else stream.write(`${JSON.stringify({ success: false, error: message, ...(hint ? { hint } : {}) })}\n`);
  return typeof error === 'object' && error !== null && 'exitCode' in error && typeof error.exitCode === 'number' ? error.exitCode : 1;
}
