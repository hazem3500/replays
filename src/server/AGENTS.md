# Server

Read the root guide. `app.ts` composes HTTP dispatch in its ordered stages (sign-in, replay files and the page shell live in `app/`; Node responses in `http/send.ts` and `http/serve-file.ts`); `start.ts` owns startup/shutdown; `config.ts` loads host settings. Auth adapters live in `auth/`, storage providers in `storage/`, media work in `media/` (list-media queue and routes), `posters.ts` (list-media renderer), `renderer.ts` and `render-queue.ts`.

- Preserve the root guide's hook/auth ordering and the separate loopback/token internal-render gate.
- Do not leak internal/provider errors to clients or turn a failed read into an empty value before writing. Check storage versions and key safety (`storage/types.ts`).
- Resource acquisition must release on failure, cancellation and shutdown. `render-scope.ts` provides Effect-backed media scope cleanup; other media paths still have their own lifecycle.
- Keep runtime code compatible with Node type stripping. No client or recorder imports.
- New environment access belongs at the configuration boundary; use injected values elsewhere. Existing scattered reads are debt, not examples.
- Update auth/storage contract tests for public behavior changes. Relevant suites: `test/app.test.ts`, `test/storage.test.ts`, `test/render-scope.test.ts`, `test/start-lifecycle.test.ts`.
- Run checks on your own Boat. `app.ts` is reserved for the Start workstream; coordinate before editing it.
