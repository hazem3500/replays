# Contributing

Thanks for helping. This is a small project; the bar for a change is "it works, it is tested, it keeps the privacy
defaults".

## Setup

Requires Node 22.12+ and pnpm 10.

```bash
pnpm install
pnpm dev                     # viewer + API on http://localhost:3000, AUTH_MODE=none
pnpm check                   # lint, format check, typecheck, unit tests, build
pnpm test:e2e                # Playwright smoke tests (needs a Chrome/Chromium: pnpm exec playwright install chromium)
```

The server and the CLI run TypeScript directly with Node's type stripping, so only *erasable* syntax is allowed
(no enums, namespaces or constructor parameter properties; `tsc` enforces it with `erasableSyntaxOnly`).

## Layout

| Path | What |
| --- | --- |
| `src/shared` | Types and validation shared by the CLI, server and viewer (replay bundle, context, source providers, retention) |
| `src/capture` | Recorder session, browser drivers (Playwright, agent-browser), sanitizer, import, upload |
| `src/server` | HTTP app, auth adapters, storage drivers, retention, tracing, optional video rendering |
| `src/client` | The viewer (React) |
| `examples/` | Example plugins (auth) |
| `site/` | The static landing page |
| `docs/` | Longer documentation |

## Guidelines

- Privacy first: a change that stores *more* of a recorded page needs a strong reason and a documented opt-in.
  Tests in `test/sanitize.test.ts` and `test/capture-playwright.test.ts` pin the guarantees.
- Add or update tests with the change; UI behaviour belongs in `e2e/`.
- Keep the product name in `src/shared/brand.ts` (and the README); do not hard-code it.
- Write commit messages in the imperative (`fix: ...`, `feat: ...`). One logical change per pull request.
- Run `pnpm check` before pushing.

## Reporting bugs and ideas

Use the issue templates. For security issues, follow [SECURITY.md](SECURITY.md) instead.

By contributing you agree that your contribution is licensed under the MIT license of this project, and to follow
the [Code of Conduct](CODE_OF_CONDUCT.md).
