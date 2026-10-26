import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'replays-lint-policy-'));
const oxlint = resolve('node_modules/oxlint/bin/oxlint');
writeFileSync(join(root, '.oxlintrc.json'), readFileSync('.oxlintrc.json'));

afterAll(() => rmSync(root, { recursive: true, force: true }));

function lint(file: string, source: string) {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
  const result = spawnSync(process.execPath, [oxlint, '--config', '.oxlintrc.json', '--deny-warnings', file], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}

describe('enforced lint boundaries', () => {
  it.each([
    '../server/start.ts',
    '../client/player.ts',
    '../capture/capture.ts',
    'node:fs',
    '@/player.ts',
    '@hazem3500/replays/server',
    '@hazem3500/replays/capture',
  ])('rejects shared contracts importing %s', (dependency) => {
    const result = lint('src/shared/leak.ts', `import * as dependency from '${dependency}';\nexport { dependency };\n`);
    expect(result.status).toBe(1);
    expect(result.output).toContain('no-restricted-imports');
  });

  it.each(['../server/start.ts', 'node:fs', '@hazem3500/replays/server', '@hazem3500/replays/plugins/iap'])(
    'rejects browser code importing %s',
    (dependency) => {
      const result = lint('src/client/leak.ts', `import * as dependency from '${dependency}';\nexport { dependency };\n`);
      expect(result.status).toBe(1);
      expect(result.output).toContain('no-restricted-imports');
    },
  );

  it('keeps shared contracts usable in the browser and Node APIs usable on the server', () => {
    expect(lint('src/client/portable.ts', "export { type ReplayBundle } from '../shared/replay.ts';\n").status).toBe(0);
    expect(lint('src/shared/portable.ts', "export { type ReplayContext } from './context.ts';\n").status).toBe(0);
    expect(lint('src/server/node.ts', "export { readFile } from 'node:fs/promises';\n").status).toBe(0);
  });

  it('rejects explicit any and executable strings in production modules', () => {
    const result = lint('src/client/unsafe.ts', 'export const execute = (source: any) => new Function(source);\n');
    expect(result.status).toBe(1);
    expect(result.output).toContain('no-explicit-any');
    expect(result.output).toContain('no-new-func');
  });
});
