import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * The installed package's version (`package.json`), what a plugin's `requires` range is checked against. Found by walking
 * up from this module: the repository when run from source, the installed package from `dist/lib` (or its chunks).
 */
function readPackageVersion() {
  for (let dir = import.meta.dirname; dir !== dirname(dir); dir = dirname(dir)) {
    const file = resolve(dir, 'package.json');
    if (!existsSync(file)) continue;
    try {
      const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: unknown; version?: unknown };
      if (pkg.name === '@hazem3500/replays' && typeof pkg.version === 'string') return pkg.version;
    } catch {
      // Not ours, or unreadable: keep walking.
    }
  }
  return '0.0.0';
}

export const PACKAGE_VERSION = readPackageVersion();

type Version = [number, number, number];
type Comparator = { op: '>=' | '>' | '<' | '<=' | '='; version: Version };

/** `1`, `1.2`, `1.2.3` (a `v` prefix and a prerelease or build suffix are ignored); missing parts are 0. */
function parseVersion(text: string): { version: Version; parts: number } | undefined {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+][0-9A-Za-z.-]*)?$/.exec(text);
  if (!match) return undefined;
  const parts = match[3] !== undefined ? 3 : match[2] !== undefined ? 2 : 1;
  return { version: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)], parts };
}

const compare = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** One space-separated term of a range as comparators that must all hold. */
function comparators(term: string): Comparator[] | undefined {
  const match = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(term);
  if (!match) return undefined;
  const op = match[1] ?? '';
  const parsed = parseVersion(match[2]!);
  if (!parsed) return undefined;
  const [major, minor, patch] = parsed.version;
  if (op === '^') {
    // The leftmost non-zero part may not change: ^1.2.3 <2.0.0, ^0.4 <0.5.0, ^0.0.3 <0.0.4.
    const upper: Version =
      major > 0 || parsed.parts === 1 ? [major + 1, 0, 0] : minor > 0 || parsed.parts === 2 ? [0, minor + 1, 0] : [0, 0, patch + 1];
    return [
      { op: '>=', version: parsed.version },
      { op: '<', version: upper },
    ];
  }
  if (op === '~') {
    // Patch-level changes: ~1.2.3 <1.3.0; ~1 <2.0.0.
    const upper: Version = parsed.parts === 1 ? [major + 1, 0, 0] : [major, minor + 1, 0];
    return [
      { op: '>=', version: parsed.version },
      { op: '<', version: upper },
    ];
  }
  // A partial version stands for all of it: `0.4` is >=0.4.0 <0.5.0, `<=0.4` is <0.5.0, `>0.4` is >=0.5.0.
  const next: Version = parsed.parts === 1 ? [major + 1, 0, 0] : [major, minor + 1, 0];
  const partial = parsed.parts < 3;
  if (op === '' || op === '=')
    return partial
      ? [
          { op: '>=', version: parsed.version },
          { op: '<', version: next },
        ]
      : [{ op: '=', version: parsed.version }];
  if (partial && op === '<=') return [{ op: '<', version: next }];
  if (partial && op === '>') return [{ op: '>=', version: next }];
  return [{ op: op as Comparator['op'], version: parsed.version }];
}

/**
 * Parses the semver subset a plugin's `requires` may use: `>=`, `>`, `<`, `<=`, `=` or a bare version, `^` and `~`, joined by
 * spaces (all must hold), e.g. `>=0.4 <0.6`, `^0.4.1`. No `||`, hyphen ranges or `x` wildcards. Undefined when malformed.
 */
export function parseRange(range: string): Comparator[] | undefined {
  if (typeof range !== 'string' || !range.trim()) return undefined;
  // `>= 0.4` is one comparator: glue an operator to the version after it.
  const terms = range
    .trim()
    .replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1')
    .split(/\s+/);
  const all: Comparator[] = [];
  for (const term of terms) {
    const parsed = comparators(term);
    if (!parsed) return undefined;
    all.push(...parsed);
  }
  return all;
}

/** True when `version` is inside `range` (see parseRange). A prerelease suffix on `version` is ignored. */
export function satisfies(version: string, range: string) {
  const parsed = parseVersion(version);
  const terms = parseRange(range);
  if (!parsed || !terms) return false;
  return terms.every(({ op, version: bound }) => {
    const order = compare(parsed.version, bound);
    return op === '>=' ? order >= 0 : op === '>' ? order > 0 : op === '<' ? order < 0 : op === '<=' ? order <= 0 : order === 0;
  });
}
