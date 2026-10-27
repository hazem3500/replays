# Browser recorder

Read the root guide. This lane is actively owned by recorder-kit work. `index.ts` is the public browser entry; `recorder.ts` controls capture; `bundle.ts` builds portable bundles; `sanitize-events.ts`/`redact.ts` enforce privacy; `upload.ts` owns upload; `default-ui.ts` supplies the current UI.

- Browser-only: no Node, server, capture or client imports. `scripts/build-recorder.mjs` checks bundled source paths and externalizes rrweb.
- Main currently exports the default UI from the recorder entry. A separate headless/UI split is in flight; do not claim it already exists or add React to the core.
- Preserve masking, upload limits, cancellation and cleanup; recording must not capture its own UI.
- Keep public export/type changes synchronized with `docs/recorder.md`, `docs/api-stability.md` and relevant tests.
- New React effects require a coordinated browser-only hook boundary; never import client hooks into this package.
- Check `pnpm test:recorder` and `pnpm build:recorder` on your own Boat. Tests live beside the implementation.
