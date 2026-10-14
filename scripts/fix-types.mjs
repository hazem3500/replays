// tsc keeps `.ts` in relative specifiers of the emitted declarations; consumers resolve `.js` -> `.d.ts`.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const dir = resolve(import.meta.dirname, '../dist/types');
async function* walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.d.ts')) yield full;
  }
}
for await (const file of walk(dir)) {
  const text = await readFile(file, 'utf8');
  const fixed = text.replace(/(from\s+|import\()(['"])(\.{1,2}\/[^'"]+)\.ts\2/g, '$1$2$3.js$2');
  if (fixed !== text) await writeFile(file, fixed);
}
