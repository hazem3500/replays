import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function packageJson() {
  const parsed: unknown = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'));
  if (!isRecord(parsed) || !isRecord(parsed.exports) || !Array.isArray(parsed.files))
    throw new Error('package.json must declare exports and files');
  return { exports: parsed.exports, files: parsed.files.filter((file): file is string => typeof file === 'string') };
}

const pkg = packageJson();

describe('public API distribution compatibility', () => {
  it('package.json exposes exactly the documented subpaths, each with types and an ES module', () => {
    expect(Object.keys(pkg.exports)).toEqual([
      '.',
      './capture',
      './server',
      './server/testing',
      './viewer',
      './plugin',
      './config',
      './plugins/iap',
      './plugins/gcs',
      './package.json',
      './recorder/early',
      './recorder/kit',
      './recorder/ui',
      './recorder/react',
      './recorder/testing',
      './recorder',
      './model',
      './viewer/playback',
      './viewer/diagnostics',
      './viewer/react',
      './viewer/playback/style.css',
      './viewer/react/style.css',
    ]);
    for (const target of Object.values(pkg.exports)) {
      if (!isRecord(target)) continue;
      expect(target.default).toMatch(/^\.\/dist\/lib\/[a-z-]+\.(mjs|css)$/);
      expect(target.types).toMatch(/^\.\/dist\/types\/.+\.d\.ts$/);
    }
  });

  it('ships what a custom distribution needs at run time: the built viewer, the samples and the docs it links to', () => {
    for (const path of ['dist/lib', 'dist/types', 'dist/client', 'sample', 'bin']) expect(pkg.files).toContain(path);
  });

  it('builds first-party plugins only on the public surface (/plugin and /server), as a third party would', () => {
    for (const file of ['iap.ts', 'gcs.ts']) {
      const source = readFileSync(resolve(import.meta.dirname, '../src/first-party', file), 'utf8');
      const imports = [...source.matchAll(/from '(\.\.?\/[^']+)'/g)].map((match) => match[1]);
      for (const path of imports) expect(path, `${file} imports ${path}`).toMatch(/^\.\.\/(plugin|server)\/index\.ts$/);
    }
  });

  it('keeps the testing entry free of any test runner, so it works under vitest, node:test or Jest', () => {
    for (const file of ['index.ts', 'storage.ts', 'auth.ts', 'runner.ts']) {
      const source = readFileSync(resolve(import.meta.dirname, '../src/server/testing', file), 'utf8');
      expect(source).not.toMatch(/^import[^\n]*from '(vitest|jest|mocha|node:test)/m);
    }
  });

  it('keeps the viewer entry free of Node and React, so a browser bundle can import it', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/client/plugins/api.ts'), 'utf8');
    expect(source).not.toMatch(/from 'node:|from 'react|from "react/);
  });
});
