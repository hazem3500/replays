import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkPlugin } from '../src/plugin/check.ts';
import { pluginFile, starterPlugin } from '../src/shared/malleable.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function file(name: string, source: string) {
  const dir = await mkdtemp(join(tmpdir(), 'replays-browser-check-'));
  dirs.push(dir);
  const path = join(dir, name);
  await writeFile(path, source);
  return path;
}

describe.skipIf(process.env.REPLAYS_PLUGIN_BROWSER_TESTS !== '1')('plugin check with isolated Chromium', () => {
  it('runs a browser entry against the real viewer registry and captures fixture output', async () => {
    const path = await file(
      'entry.mjs',
      `export default api=>{ api.registerInspectorTab({id:'hello',label:'Hello',render(el,ctx){el.textContent='Fixture '+ctx.replay.meta.id}});api.registerViewerAction({id:'say',label:'Say',run(ctx){ctx.notify('action ran')}});api.registerPluginPage({title:'Check page',loader:async()=>42,render(el,ctx){el.textContent='Loaded '+ctx.data;ctx.navigate('next')}}) };`,
    );
    const result = await checkPlugin({ file: path, kind: 'browser', headless: true });
    expect(result.errors).toEqual([]);
    expect(result.output).toContain('tabs plugin:check:hello');
    expect(result.output).toContain('plugin:check:hello: Fixture plugin-check');
    expect(result.output).toContain('notify action ran');
    expect(result.output).toContain('pages plugin:check:page: Loaded 42');
    expect(result.output).toContain('navigate next');
  }, 30_000);

  it('runs a real sandbox with settings and reports syntax and permission errors', async () => {
    const starter = starterPlugin();
    starter.manifest.settings = [{ id: 'compact', label: 'Compact', type: 'boolean', default: false }];
    const source = `replays.tab('main',async (el,ctx)=>{el.textContent=String(await ctx.settings.get('compact'));await ctx.settings.set('compact',true);console.log('settings '+await ctx.settings.get('compact'));});`;
    const path = await file('valid.replays-plugin.json', JSON.stringify(pluginFile(starter.manifest, source)));
    const result = await checkPlugin({ file: path, headless: true });
    expect(result.errors).toEqual([]);
    expect(result.output).toContain('tab:main: settings true');
    const bad = await file(
      'bad.replays-plugin.json',
      JSON.stringify(pluginFile(starter.manifest, `replays.tab('main',()=>{ throw new Error('sandbox fixture error') });`)),
    );
    const failure = await checkPlugin({ file: bad, headless: true });
    expect(failure.errors.join(' ')).toMatch(/sandbox fixture error/);
  }, 30_000);
});
