import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkPlugin, parseCheckArgs } from '../src/plugin/check.ts';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function plugin(source: string) {
  const dir = await mkdtemp(join(tmpdir(), 'replays-check-test-'));
  temporary.push(dir);
  const file = join(dir, 'plugin.mjs');
  await writeFile(file, source);
  return file;
}

describe('replays plugin check', () => {
  it('parses files and rejects unknown options or missing values', () => {
    expect(parseCheckArgs(['plugin.mjs', '--kind', 'browser', '--cdp', 'http://localhost:9222'])).toMatchObject({
      kind: 'browser',
      cdp: 'http://localhost:9222',
    });
    expect(parseCheckArgs(['plugin.mjs', '--headless', '--kind', 'browser'])).toMatchObject({ headless: true, kind: 'browser' });
    expect(() => parseCheckArgs(['plugin.mjs', '--headless', '--cdp', 'http://localhost:9222'])).toThrow(/mutually exclusive/);
    expect(() => parseCheckArgs([])).toThrow(/file/);
    expect(() => parseCheckArgs(['a', '--replay'])).toThrow(/value/);
    expect(() => parseCheckArgs(['a', '--kind', 'unknown'])).toThrow(/server, browser or user/);
    expect(() => parseCheckArgs(['a', '--typo', 'b'])).toThrow(/unknown option/);
  });

  it('runs setup and fixture hooks and reports actual summary output', async () => {
    const file = await plugin(
      `export default {name:'fixture',apiVersion:1,setup(api){api.summaryFields({name:'counts',fields(replay){return {requests:replay.network.length}}});api.beforeUpload(({bundle})=>bundle)}};`,
    );
    const result = await checkPlugin({ file });
    expect(result.errors).toEqual([]);
    expect(result.output).toContain('plugins: fixture');
    expect(result.output).toContain('fixture/counts: {"requests":0}');
    expect(result.output).toContain('PASS fixture beforeUpload fixture');
  });

  it('fails invalid registrations, throwing hooks and malformed user files with diagnostics', async () => {
    const file = await plugin(
      `export default {name:'broken',apiVersion:1,setup(api){api.beforeUpload(()=>{throw new Error('fixture rejected')})}};`,
    );
    expect((await checkPlugin({ file })).errors).toContain('broken beforeUpload fixture: fixture rejected');
    const bad = await plugin(
      `export default {name:'invalid',apiVersion:1,setup(api){api.summaryFields({name:'UPPER',fields(){return {}}})}};`,
    );
    expect((await checkPlugin({ file: bad })).errors.join(' ')).toMatch(/summaryFields/);
    const dir = await mkdtemp(join(tmpdir(), 'replays-check-json-'));
    temporary.push(dir);
    const json = join(dir, 'bad.replays-plugin.json');
    await writeFile(json, '{}');
    expect((await checkPlugin({ file: json })).errors.join(' ')).toMatch(/format/);
  });

  it('runs the storage contract inside disposable namespaces', async () => {
    const memory = new URL('../src/server/storage/memory.ts', import.meta.url).href;
    const file = await plugin(
      `import {MemoryStorage} from ${JSON.stringify(memory)}; const store=new MemoryStorage(); export default {name:'memory-check',apiVersion:1,setup(api){api.storage({id:'fixture',create:()=>store})}};`,
    );
    const result = await checkPlugin({ file });
    expect(result.errors).toEqual([]);
    expect(result.output.filter((line) => line.startsWith('PASS ')).length).toBeGreaterThan(5);
  });
});
