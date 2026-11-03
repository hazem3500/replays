# Contributing

Thanks for helping. This is a small project; the bar for a change is "it works, it is tested, it keeps the privacy
defaults".

## Setup

Requires Node 22.22+ (22.x), 24.11+ (24.x), or 26+ and pnpm 10.

```bash
pnpm install
pnpm dev                     # viewer + API on http://localhost:3000, AUTH_MODE=none
pnpm check                   # lint, format check, typecheck, unit tests, build
pnpm test:e2e                # Playwright smoke tests (needs a Chrome/Chromium: pnpm exec playwright install chromium)
```

The server and the CLI run TypeScript directly with Node's type stripping, so only *erasable* syntax is allowed
(no enums, namespaces or constructor parameter properties; `tsc` enforces it with `erasableSyntaxOnly`).

## Tooling

[Vite+ 1.4.0](https://viteplus.dev/guide/) supplies Vite, Vitest, Oxlint and Oxfmt through the project-local
`vp` binary; a global installation is optional. `pnpm build`, `pnpm test`, `pnpm lint` and `pnpm format`
use that pinned toolchain. `pnpm check` also runs TypeScript, unit tests and the production viewer build;
Vite+'s built-in `vp check` does not replace this full gate.

Run `pnpm format` to write changes or `pnpm format:check` to check without writing. [.oxfmtrc.json](.oxfmtrc.json)
keeps 2 spaces, 140 columns, single JavaScript quotes, double JSX quotes, semicolons and trailing commas.
CSS, Markdown, YAML, TOML and HTML/template files remain outside formatting. Import, package.json and
Tailwind class sorting are disabled. Keep formatting-only changes in their own commit.

The explicit [.oxlintrc.json](.oxlintrc.json) and [.oxlintrc.types.json](.oxlintrc.types.json) remain the lint policy:
`pnpm lint` includes the type-aware `src/shared` gate; `pnpm lint:types:audit` runs the broader audit.
Standalone Oxlint is pinned to Vite+'s bundled version because the lint-policy tests invoke its executable.
Vitest is also pinned to the bundled version to preserve the existing test imports and `vitest/globals` types.
The workspace overrides keep Storybook, plugins and tests on one Vite core and one Vitest version.

`pnpm dev` starts the Node API server with Vite middleware and HMR. `vp dev` alone starts only Vite.
Storybook keeps its isolated config. Unit tests keep their separate config so they do not inherit the
application's HTML transforms, React compiler or Tailwind plugins. Library, CLI and recorder builds retain
esbuild, their declaration tsconfigs and specifier repair scripts; moving these to `vp pack`/tsdown requires
separate validation of export paths, shared chunks and browser boundaries.

On the shared devbox, run installs, checks and servers in the session's own Boat box with `oz-boat exec -- <command>`.
Stop that box at handoff. See [toolchain details](docs/tooling.md) for the upstream references and verification commands.

## Layout

| Path | What |
| --- | --- |
| `src/shared` | Types and validation shared by the CLI, server and viewer (replay bundle, context, source providers, retention) |
| `src/capture` | Recorder session, browser drivers (Playwright, agent-browser), sanitizer, import, upload |
| `src/server` | HTTP app, auth adapters, storage drivers, retention, tracing, optional video rendering |
| `src/client` | The viewer (React) |
| `examples/` | Example plugins (auth) and `custom-distro`, a runnable distribution on the extension surface |
| `site/` | The static landing page |
| `docs/` | Longer documentation |

## Guidelines

- Privacy first: a change that stores *more* of a recorded page needs a strong reason and a documented opt-in.
  Tests in `test/sanitize.test.ts` and `test/capture-playwright.test.ts` pin the guarantees.
- Add or update tests with the change; UI behaviour belongs in `e2e/`.
- Keep the product name in `src/shared/brand.ts` (and the README); do not hard-code it.
- Write commit messages in the imperative (`fix: ...`, `feat: ...`). One logical change per pull request.
- Run `pnpm check` before pushing.

## Pull requests and CI

Open a draft with `gh pr create --draft` and push freely; CI skips drafts. Run `gh pr ready` when the change is
done to start the Gate (lint, format, types, unit tests, builds and quality audits through Turborepo and its shared
cache). End-to-end and browser suites run on main and nightly; add the `run-e2e` label to run them on your pull
request. They also start by themselves for recorder, capture, render, server-rendering, packaging and dependency
changes (the list is `RISKY` in `scripts/ci-scope.mjs`).

## Reporting bugs and ideas

Use the issue templates. For security issues, follow [SECURITY.md](SECURITY.md) instead.

By contributing you agree that your contribution is licensed under the MIT license of this project, and to follow
the [Code of Conduct](CODE_OF_CONDUCT.md).
