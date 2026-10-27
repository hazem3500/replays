import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const sampleDir = join(root, 'demo-seed-output', 'sample');
const sourcePath = join(sampleDir, 'demo-seed-signup.json');
const targetPath = join(sampleDir, 'demo-purposes-walkthrough.json');
const source = JSON.parse(await readFile(sourcePath, 'utf8'));

if (source.meta?.id !== 'demo-seed-signup' || source.meta?.tags?.includes('demo') !== true || !source.steps?.length)
  throw new Error('expected the generated demo-seed-signup replay with demo tags and steps');

const walkthrough = structuredClone(source);
walkthrough.meta.id = 'demo-purposes-walkthrough';
walkthrough.meta.title = 'Signup walkthrough · masked demo form';
walkthrough.meta.url = 'https://walkthrough.northstar.demo.test/join';
walkthrough.meta.tags = [...new Set([...walkthrough.meta.tags, 'walkthrough'])];
delete walkthrough.suiteRun;
const initialPage = walkthrough.events.find((event) => event.type === 4);
if (initialPage?.data && typeof initialPage.data === 'object') initialPage.data.href = walkthrough.meta.url;

const contents = `${JSON.stringify(walkthrough)}\n`;
try {
  const existing = await readFile(targetPath, 'utf8');
  if (existing !== contents) throw new Error(`${targetPath} exists with different content; refusing to overwrite it`);
} catch (error) {
  if (error instanceof Error && !('code' in error && error.code === 'ENOENT')) throw error;
  await writeFile(targetPath, contents, { flag: 'wx' });
}

console.log(`Prepared ${targetPath}`);
