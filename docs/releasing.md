# Releasing

Nothing in this repository publishes automatically, and `package.json` is `"private": true`, which makes
`npm publish` refuse.

On 2026-11-03, Hazem authorized establishing the public npm name. npm rejected `replays` because of its similarity to
`re-plays`; the approved fallback `replays-cli` is now registered to `hazem3500`. A functional `0.1.0-alpha.0` package
was submitted with `next`, and npm returned HTTP 202. Public verification currently shows only `0.0.0-stage`, npm's
holding version, and no `next` tag. The submitted version must become public before it can be advertised as installable.
The source-only Settings instructions remain valid in the meantime.

## What the release workflow does

`.github/workflows/release.yml` runs on a `v*` tag or by hand (*Actions → Release → Run workflow*, `dry_run` defaults
to true). It runs `pnpm check`, builds the CLI and library, packs a tarball and attaches it to the workflow run as an
artifact. The npm publish job runs only when **all** of these hold: an `NPM_TOKEN` secret exists, `package.json` is
no longer private, and `dry_run` is false. Otherwise it is skipped.

## Publishing to npm (when you decide to)

1. The public name is decided (see [NAMING.md](NAMING.md)): use `replays-cli`, retaining the `replays` binary. Align the
   source manifest, consumer examples and release workflow with this name before promoting a stable release.
2. Remove `"private": true`; check `pnpm pack --dry-run` lists only `bin`, `dist/cli`, `dist/lib`, `dist/types`.
3. Add an `NPM_TOKEN` repository secret (or configure trusted publishing) and an `npm` environment with a reviewer.
4. Move `## [0.1.0] - Unreleased` in `CHANGELOG.md` to a dated heading, tag `v0.1.0`, push the tag.

After the first stable version is published and verified on npm, the main package provides the global CLI:

```sh
npm install --global replays-cli
replays --help
```

This is the planned stable install path, not a working npm installation today. The executable is `replays`.
Do not recommend `npm install --global replays`. When the stable release is available,
replace the source-only setup in Settings and the README with this command, and use `replays` for the connection
and upload examples. The current source setup builds the package and installs it with `npm install -g .`, so those
examples already use the installed `replays` executable. Keep source setup as an alternative for contributors.

## Container images

No registry login or push step exists. To publish one, add a job using `docker/login-action` and
`docker/build-push-action` with `push: true`, gated on a repository variable such as `PUBLISH_IMAGE == 'true'`, and
use `GITHUB_TOKEN` with `packages: write` for GHCR.

## Landing page

`.github/workflows/pages.yml` is manual-only; see [site.md](site.md).
