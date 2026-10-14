# Landing page and static demo

`site/` is a static landing page (plain HTML and CSS, no framework, no external requests). `pnpm build:site` turns it
into a deployable folder, `dist/site`, that also contains the real viewer running without a server.

## Build

```sh
pnpm install --frozen-lockfile
pnpm build:site          # runs `pnpm build` first when dist/client is missing
```

Output in `dist/site`:

- `index.html`, `style.css`, `site.js`, `favicon.svg`, `assets/`: the landing page. Every URL is relative, so it works at a
  domain root and under a sub-path such as `/replay-kit/`.
- `demo/`: the viewer build, with JSON files under `demo/api/` generated from `sample/demo-shop.json` and
  `sample/human-demo.json`.
- `_headers`, `_redirects` (Cloudflare Pages) and `.nojekyll` (GitHub Pages).

Screenshots: `docs/screenshots/*.png` are copied into `assets/` when present. A missing screenshot hides its figure, and
the whole strip disappears when there are none.

Preview locally with any static file server, for example `npx serve dist/site`.

## Deploy

Nothing is deployed by the build.

**Cloudflare Pages**: connect the repository, build command `pnpm install --frozen-lockfile && pnpm build:site`, output
directory `dist/site`, environment variable `NODE_VERSION=22`.

**GitHub Pages**: enable Pages with the "GitHub Actions" source (Settings, Pages), then run the manual workflow
`.github/workflows/pages.yml` ("Landing page (manual)"). It builds and publishes `dist/site`. Project pages live under
`/<repository>/`, which the page and the demo handle.

## The demo

The viewer is the production build. It reads `<base>/api/...` JSON, so the build writes those responses as static files:
`api/me`, `api/config`, `api/suites`, `api/replays` (summaries), `api/replays/<id>` (the bundle) and
`api/replays/<id>/keep` and `/render`. Each is stored as `<path>/index.html` because a file and a folder of the same
name cannot coexist and every static host serves directory indexes. The viewer parses the body regardless of content type;
`_headers` sets `application/json` where supported (GitHub Pages serves `text/html`, which is harmless).

A small inline script in each demo page sets `<meta name="app-base">` at load time from the URL (everything up to
`/demo`), so the folder can be mounted under any prefix. `demo/r/demo-shop/` and `demo/r/human-demo/` are real files, so
reloads and deep links (including `?t=<seconds>`) work on any host. `demo/` itself is the replay index. On Cloudflare
Pages, `_redirects` sends unknown `/demo/r/*` paths to the viewer, which reports "Replay not found".

What works: the index, playback, scrubbing, tabs, error markers, shortcuts, permalinks, theme switch.

What does not (there is no server):

- Uploading and importing replays (the upload button fails with an error).
- Keep and retention: the samples are marked as never expiring, so Keep is not offered.
- Video export: reported as unavailable.
- Index thumbnails: they fall back to placeholder letters.
- Suites: the list is empty.

## Rename the product

Change `PRODUCT_NAME` (and `PRODUCT_SLUG`) in `src/shared/brand.ts`, then rebuild. Source files in `site/` use the
`__PRODUCT_NAME__` placeholder, which the build replaces, so the name appears in the static HTML without JavaScript. The
GitHub URL and the capture example in `site/index.html` are plain text: update them if the repository or command name changes.
