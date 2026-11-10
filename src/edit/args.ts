import { usageError } from './errors.ts';

export interface ParsedArgs {
  positionals: string[];
  values: Record<string, string>;
  booleans: Set<string>;
}

const SHORT: Record<string, string> = { o: 'output', h: 'help' };

/**
 * `--flag value`, `--flag=value`, `-o value`, boolean flags (`booleans`, no value) and positionals. Flags outside `known` are
 * a usage error, so a typo never silently edits the wrong thing. A bare `--` is ignored.
 */
export function parseArgs(argv: readonly string[], known: { values: readonly string[]; booleans: readonly string[] }): ParsedArgs {
  const parsed: ParsedArgs = { positionals: [], values: {}, booleans: new Set() };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token === '--') continue;
    const flag = /^--([a-z][a-z-]*)(?:=(.*))?$/s.exec(token) ?? /^-([a-z])$/.exec(token);
    if (!flag) {
      parsed.positionals.push(token);
      continue;
    }
    const name = SHORT[flag[1]!] ?? flag[1]!;
    if (known.booleans.includes(name)) {
      if (flag[2] !== undefined) throw usageError(`--${name} takes no value`);
      parsed.booleans.add(name);
    } else if (known.values.includes(name)) {
      const value = flag[2] ?? argv[++index];
      if (value === undefined || (flag[2] === undefined && /^--[a-z]/.test(value))) throw usageError(`--${name} takes a value`);
      parsed.values[name] = value;
    } else throw usageError(`unknown option ${token}; run \`replays edit --help\``);
  }
  return parsed;
}
