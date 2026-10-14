// Builds the static landing page plus a server-less copy of the viewer into dist/site:
//   dist/site/            site/ with the product name filled in (index.html, style.css, assets/, ...)
//   dist/site/demo/       the viewer build (dist/client) reading JSON files from demo/api/ instead of a server
// Nothing is deployed or fetched; the output is plain files for any static host (docs/site.md).
import { execFileSync } from 'node:child_process';
import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const siteSource = join(root, 'site');
const clientBuild = join(root, 'dist/client');
const out = join(root, 'dist/site');
const demo = join(out, 'demo');

const SAMPLES = ['demo-shop', 'human-demo'];
/** The replay the landing page embeds, and the one the demo index opens first. */
const FEATURED = 'demo-shop';

/** The shared TypeScript modules, bundled in memory so this script runs on any supported Node without type stripping. */
async function loadShared() {
  const result = await build({
    stdin: {
      contents: `export { PRODUCT_NAME, PRODUCT_SLUG } from './src/shared/brand.ts';
export { summarizeReplay } from './src/shared/replay.ts';`,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

const { PRODUCT_NAME, PRODUCT_SLUG, summarizeReplay } = await loadShared();

const fill = (text) =>
  text.replaceAll('__PRODUCT_NAME__', PRODUCT_NAME).replaceAll('__PRODUCT_SLUG__', PRODUCT_SLUG).replaceAll('__PRODUCT_LOGO__', '');

async function writeText(path, text) {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, text);
}

/**
 * One JSON document per API path, stored as `<path>/index.html`: a file `api/replays` and a directory
 * `api/replays/<id>` cannot both exist, while directory indexes are served by every static host (GitHub Pages
 * redirects `/api/replays` to `/api/replays/`, which fetch() follows). The viewer parses the body whatever its
 * content type is; `_headers` still labels it application/json where the host supports that.
 */
async function writeApi(path, value) {
  await writeText(join(demo, 'api', path, 'index.html'), JSON.stringify(value));
}

// 1. The viewer build.
if (!existsSync(join(clientBuild, 'index.html'))) {
  console.log('dist/client is missing: running the viewer build');
  execFileSync('pnpm', ['build'], { cwd: root, stdio: 'inherit' });
}

await rm(out, { recursive: true, force: true });

// 2. The landing page: site/ with the name filled in, plus the font and the screenshots that exist.
await mkdir(join(out, 'assets'), { recursive: true });
for (const entry of await readdir(siteSource, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    await cp(join(siteSource, entry.name), join(out, entry.name), { recursive: true });
  } else if (/\.(html|css|js|svg|txt)$/.test(entry.name)) {
    await writeText(join(out, entry.name), fill(await readFile(join(siteSource, entry.name), 'utf8')));
  } else {
    await copyFile(join(siteSource, entry.name), join(out, entry.name));
  }
}
await copyFile(join(root, 'src/client/fonts/inter-latin-wght-normal.woff2'), join(out, 'assets/inter-latin-wght-normal.woff2'));

const shotsDir = join(root, 'docs/screenshots');
const shots = existsSync(shotsDir) ? (await readdir(shotsDir)).filter((name) => name.endsWith('.png')) : [];
for (const name of shots) await copyFile(join(shotsDir, name), join(out, 'assets', name));

let page = await readFile(join(out, 'index.html'), 'utf8');
// Each <!--shot NAME.png-->...<!--/shot--> block stays (markers dropped) only when its file was copied; the whole strip
// goes when none was.
page = page.replace(/<!--shot ([\w.-]+)-->([\s\S]*?)<!--\/shot-->/g, (_all, name, body) => (shots.includes(name) ? body : ''));
if (!/<figure/.test(page)) page = page.replace(/<!--shots-->[\s\S]*?<!--\/shots-->/, '');
else page = page.replace(/<!--\/?shots-->/g, '');
await writeFile(join(out, 'index.html'), page);

// 3. The viewer, without a server.
await cp(clientBuild, demo, { recursive: true });
await rm(join(demo, 'render.html'), { force: true });

const bundles = [];
for (const id of SAMPLES) bundles.push(JSON.parse(await readFile(join(root, 'sample', `${id}.json`), 'utf8')));

await writeApi('me', { id: 'demo' });
await writeApi('config', { name: PRODUCT_NAME, sourceProviders: [], auth: 'none' });
await writeApi('suites', []);
await writeApi(
  'replays',
  bundles.map((bundle) => summarizeReplay(bundle)),
);
for (const bundle of bundles) {
  await writeApi(`replays/${bundle.meta.id}`, bundle);
  // `committed`: a sample that never expires and cannot be kept, so the viewer offers no Keep action.
  await writeApi(`replays/${bundle.meta.id}/keep`, { expiresAt: null, committed: true });
  // The video export asks whether a render service exists; "unavailable" disables it without an error.
  await writeApi(`replays/${bundle.meta.id}/render`, { status: 'unavailable' });
}

/**
 * The viewer's index.html with the base path decided at load time: this folder can sit under any prefix
 * (/demo/ at a domain root, /replay-kit/demo/ on GitHub project pages). `depth` is how many folders below the
 * demo root the page lives, so its asset links point back up.
 */
const viewerHtml = fill(await readFile(join(clientBuild, 'index.html'), 'utf8'));
const BASE_META = '<meta name="app-base" content="" />';
if (!viewerHtml.includes(BASE_META)) throw new Error('dist/client/index.html has no app-base meta tag to fill');
const baseScript = `<script>
      // Static demo: the app lives at the folder this page was served from, up to and including "/demo".
      (function () {
        var match = /^(.*?\\/demo)(?:\\/(?:r|s)\\/|\\/?$|\\/index\\.html$)/.exec(location.pathname);
        document.querySelector('meta[name="app-base"]').content = match ? match[1] : '/demo';
      })();
    </script>`;

function viewerPage(depth) {
  const up = depth === 0 ? './' : '../'.repeat(depth);
  return viewerHtml.replace(BASE_META, `${BASE_META}\n    ${baseScript}`).replaceAll('./assets/', `${up}assets/`);
}

await writeText(join(demo, 'index.html'), viewerPage(0));
for (const bundle of bundles) await writeText(join(demo, 'r', bundle.meta.id, 'index.html'), viewerPage(2));

// 4. Host files. `_headers` and `_redirects` are read by Cloudflare Pages; GitHub Pages ignores them.
await writeText(
  join(out, '_headers'),
  `/demo/api/*
  Content-Type: application/json; charset=utf-8
  Cache-Control: public, max-age=300

/demo/assets/*
  Cache-Control: public, max-age=31536000, immutable
`,
);
// Replays other than the two bundled ones fall back to the viewer, which reports "Replay not found".
await writeText(
  join(out, '_redirects'),
  `/demo/r/* /demo/r/${FEATURED}/index.html 200
/demo/s/* /demo/index.html 200
`,
);
// Keeps GitHub Pages from running Jekyll over the output (it would skip files whose names start with an underscore).
await writeText(join(out, '.nojekyll'), '');

console.log(`Static site written to ${out} (${shots.length} screenshot${shots.length === 1 ? '' : 's'}, ${bundles.length} demo replays)`);
