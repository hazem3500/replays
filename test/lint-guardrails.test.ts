import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'replays-guardrails-'));
const plugin = resolve('tools/oxlint-plugin-replays/index.mjs');
const oxlint = resolve('node_modules/oxlint/bin/oxlint');

function lint(rule: string, file: string, source: string) {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
  writeFileSync(
    join(root, '.oxlintrc.json'),
    JSON.stringify({
      plugins: [],
      categories: { correctness: 'off' },
      jsPlugins: [{ name: 'replays', specifier: plugin }],
      rules: { [`replays/${rule}`]: 'error' },
    }),
  );
  const result = spawnSync(process.execPath, [oxlint, '--config', '.oxlintrc.json', '--threads', '1', '--format', 'json', file], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (![0, 1].includes(result.status ?? -1)) throw new Error(`Plugin crashed: ${result.stderr}`);
  return { status: result.status, output: result.stdout };
}

describe('project invariant lint rules', () => {
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  it.each([
    ['comment-policy', 'src/client/example.tsx', 'export function Panel() { // explain the panel\n return <div />; }'],
    ['comment-policy', 'src/client/example.tsx', 'export const Panel = () => <div>{/* show the content */}</div>;'],
    ['comment-policy', 'src/shared/example.ts', '// Some shared code\nexport const value = 1;'],
    ['disable-needs-why', 'src/shared/example.ts', '// oxlint-disable-next-line no-console\nconsole.log(1);'],
    ['no-effect-outside-hooks', 'src/client/example.tsx', "import { useEffect as setup } from 'react'; export { setup };"],
    ['no-effect-outside-hooks', 'src/client/example.tsx', "import React from 'react'; export const setup = React['useEffect'];"],
    ['no-effect-outside-hooks', 'src/recorder/react/example.tsx', "import { useEffect } from 'react'; export { useEffect };"],
    ['no-effect-outside-hooks', '.storybook/preview.tsx', "import { useEffect } from 'react'; export { useEffect };"],
    ['no-effect-outside-hooks', 'stories/recorder-custom/Panel.tsx', "import { useEffect } from 'react'; export { useEffect };"],
    ['no-effect-outside-hooks', 'src/recorder/react/hooks.ts', "import { useEffect } from 'react'; export { useEffect };"],
    ['no-effect-outside-hooks', 'src/client/example.tsx', "export { useEffect as setup } from 'react';"],
    [
      'no-effect-outside-hooks',
      'src/client/example.tsx',
      "import React from 'react'; const { useEffect: setup } = React; export { setup };",
    ],
    ['no-manual-memo', 'src/client/example.tsx', "export { memo } from 'react';"],
    ['comment-policy', 'src/shared/example.ts', 'export function read() { /** Narrating local value. */ const value = 1; return value; }'],
    ['comment-policy', 'src/shared/example.ts', 'export function read() { // security: unapproved tag\n return 1; }'],
    ['max-jsx-depth', 'src/client/example.tsx', `export const Panel = () => ${'<div>'.repeat(8)}value${'</div>'.repeat(8)};`],
    ['no-manual-memo', 'src/client/hooks/example.ts', "import { useMemo } from 'react'; export { useMemo };"],
    ['no-manual-memo', 'stories/example.tsx', "import * as React from 'react'; export const memo = React.memo;"],
    ['no-manual-memo', '.storybook/preview.tsx', "import { useMemo } from 'react'; export { useMemo };"],
    ['no-forward-ref', 'src/client/example.tsx', "import { forwardRef } from 'react'; export { forwardRef };"],
    ['no-process-env', 'src/server/example.ts', "export const value = process['env'].VALUE;"],
    ['no-manual-navigation', 'src/client/example.ts', "history.pushState({}, '', '/');"],
    ['no-manual-navigation', 'src/client/example.ts', 'export const search = new URLSearchParams(location.search);'],
    ['no-raw-fetch', 'src/client/example.ts', "export const result = globalThis.fetch('/api/me');"],
    ['no-direct-storage', 'src/client/example.ts', "export const value = window['localStorage'].getItem('value');"],
    ['max-component-props', 'src/client/example.tsx', 'export function Panel({a,b,c,d,e,f,g,h,i}) { return <div />; }'],
    ['no-product-name-literal', 'src/shared/example.ts', "export const name = 'replays';"],
    ['no-throw-plain-error-in-routes', 'src/server/comments-routes.ts', "throw new Error('oops');"],
    ['no-render-time-store-read', 'src/client/example.tsx', 'export function Panel() { return player.getTime(); }'],
  ])('rejects %s in %s', (rule, file, source) => {
    const result = lint(rule, file, source);
    expect(result.status).toBe(1);
    expect(result.output).toContain(rule);
  });

  it.each([
    ['comment-policy', 'src/shared/example.ts', '/** A stable millisecond timestamp. */\nexport const value = 1;'],
    ['comment-policy', 'src/shared/example.ts', 'export function read() { // why: runtime APIs return milliseconds.\n return 1; }'],
    ['comment-policy', 'src/client/example.tsx', 'export const Panel = () => <div>{/* invariant: no private values here. */}</div>;'],
    [
      'comment-policy',
      'src/shared/example.ts',
      '// @ts-expect-error -- fixture has no ambient declaration\nexport const value = unknownValue;',
    ],
    [
      'disable-needs-why',
      'src/shared/example.ts',
      '// oxlint-disable-next-line no-console -- why: CLI output is its public interface.\nconsole.log(1);',
    ],
    ['no-effect-outside-hooks', 'src/client/hooks/use-example.ts', "import { useEffect } from 'react'; export { useEffect };"],
    ['no-effect-outside-hooks', 'src/recorder/react/hooks/lifecycle.ts', "import { useEffect } from 'react'; export { useEffect };"],
    ['no-effect-outside-hooks', 'stories/recorder-custom/hooks/fixture.ts', "import { useEffect } from 'react'; export { useEffect };"],
    ['no-forward-ref', 'src/client/example.tsx', "import * as React from 'react'; export const Panel = () => React.createElement('div');"],
    ['max-component-props', 'src/server/example.ts', 'export function Parse({a,b,c,d,e,f,g,h,i}) { return a; }'],
    ['max-jsx-depth', 'src/client/example.tsx', `export const Panel = () => ${'<div>'.repeat(7)}value${'</div>'.repeat(7)};`],
    ['comment-policy', 'src/shared/example.ts', 'export class Revision { /** Monotonic storage revision. */ value = 1; }'],
    ['no-process-env', 'src/server/config.ts', 'export const value = process.env.VALUE;'],
    ['no-manual-navigation', 'src/client/navigation.ts', "history.pushState({}, '', '/');"],
    ['no-raw-fetch', 'src/client/queries.ts', "export const result = fetch('/api/me');"],
    ['no-direct-storage', 'src/client/storage.ts', "export const value = localStorage.getItem('value');"],
    ['no-product-name-literal', 'src/shared/brand.ts', "export const PRODUCT_NAME = 'replays';"],
    [
      'no-render-time-store-read',
      'src/client/example.tsx',
      'export function Panel() { return <button onClick={() => player.getTime()} />; }',
    ],
  ])('allows the documented %s boundary in %s', (rule, file, source) => {
    expect(lint(rule, file, source).status).toBe(0);
  });
});
