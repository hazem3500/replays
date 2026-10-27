import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Vite/esbuild content hashes change between builds; logical names survive code changes.
export function bundleKey(file) {
  return file.replaceAll('\\', '/').replace(/-[A-Za-z0-9_-]{8}(?=\.[^.]+$)/, '-HASH');
}

export async function bundleInventory(root) {
  const checks = new Map();
  const chunks = new Map();
  for (const [metadata, directory] of [
    ['dist/lib/.metafile.json', 'dist/lib/chunks/'],
    ['dist/lib/.recorder-metafile.json', 'dist/lib/recorder-chunks/'],
  ]) {
    const raw = await readFile(resolve(root, metadata), 'utf8').catch((error) => {
      if (metadata.endsWith('/.recorder-metafile.json') && error.code === 'ENOENT') return null;
      throw error;
    });
    if (raw === null) continue;
    const library = JSON.parse(raw);
    for (const [output, details] of Object.entries(library.outputs)) {
      const absolute = resolve(root, output);
      if (!relative(root, absolute).startsWith(directory)) continue;
      const sources = Object.keys(details.inputs)
        .map((input) => relative(root, resolve(root, input)))
        .sort();
      if (!sources.length) throw new Error(`Shared chunk has no source identity: ${output}`);
      const hash = createHash('sha256').update(sources.join('\n')).digest('hex').slice(0, 12);
      chunks.set(absolute, `${directory}${basename(sources[0])}-${hash}.mjs`);
    }
  }
  async function walk(directory) {
    for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
      // Only these unpublished build metadata files are exempt; new hidden runtime assets need budgets too.
      if (
        (directory === 'dist/client' && entry.name === '.vite') ||
        (directory === 'dist/lib' && ['.metafile.json', '.recorder-metafile.json'].includes(entry.name))
      )
        continue;
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else {
        const key = chunks.get(resolve(root, file)) ?? bundleKey(relative(root, resolve(root, file)));
        if (checks.has(key)) throw new Error(`Ambiguous bundle identity: ${key}`);
        checks.set(key, [resolve(root, file)]);
      }
    }
  }
  for (const directory of ['dist/client', 'dist/lib', 'dist/cli', 'bin']) await walk(directory);
  const manifest = JSON.parse(await readFile(resolve(root, 'dist/client/.vite/manifest.json'), 'utf8'));
  for (const [entry, chunk] of Object.entries(manifest)) {
    if (!chunk.isEntry) continue;
    const visited = new Set();
    const js = new Set();
    const css = new Set();
    function visit(key) {
      if (visited.has(key)) return;
      visited.add(key);
      const item = manifest[key];
      if (!item) throw new Error(`Missing manifest import: ${key}`);
      if (item.file.endsWith('.js')) js.add(resolve(root, 'dist/client', item.file));
      for (const file of item.css ?? []) css.add(resolve(root, 'dist/client', file));
      // Dynamic imports stay lazy and get their own per-file budgets above.
      for (const dependency of item.imports ?? []) visit(dependency);
    }
    visit(entry);
    if (js.size) checks.set(`initial/${entry}/js`, [...js].sort());
    if (css.size) checks.set(`initial/${entry}/css`, [...css].sort());
  }
  if (!checks.has('initial/index.html/js') || !checks.has('initial/index.html/css')) throw new Error('Missing client initial JS/CSS');
  return Object.fromEntries([...checks].sort(([a], [b]) => a.localeCompare(b)));
}
