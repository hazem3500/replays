# Releasing

Nothing in this repository publishes automatically, and `package.json` is `"private": true`, which makes
`npm publish` refuse.

## What the release workflow does

`.github/workflows/release.yml` runs on a `v*` tag or by hand (*Actions → Release → Run workflow*, `dry_run` defaults
to true). It runs `pnpm check`, builds the CLI and library, packs a tarball and attaches it to the workflow run as an
artifact. The npm publish job runs only when **all** of these hold: an `NPM_TOKEN` secret exists, `package.json` is
no longer private, and `dry_run` is false. Otherwise it is skipped.

## Publishing to npm (when you decide to)

1. The name is decided (see [NAMING.md](NAMING.md)): the package is `@hazem3500/replays`. npm rejected the unscoped
   `replays` as too similar to `re-plays`. Because it is a scoped public package, publish with
   `npm publish --access=public` (the workflow's `pnpm publish --access public` does the same).
2. Remove `"private": true`; check `pnpm pack --dry-run` lists only `bin`, `dist/cli`, `dist/lib`, `dist/types`.
3. Add an `NPM_TOKEN` repository secret (or configure trusted publishing) and an `npm` environment with a reviewer.
4. Move `## [0.1.0] - Unreleased` in `CHANGELOG.md` to a dated heading, tag `v0.1.0`, push the tag.

## Container images

No registry login or push step exists. To publish one, add a job using `docker/login-action` and
`docker/build-push-action` with `push: true`, gated on a repository variable such as `PUBLISH_IMAGE == 'true'`, and
use `GITHUB_TOKEN` with `packages: write` for GHCR.

## Landing page

`.github/workflows/pages.yml` is manual-only; see [site.md](site.md).
