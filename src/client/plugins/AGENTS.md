# Browser plugin platform

Read the root guide and `src/plugin/AGENTS.md`. The extension-platform lane owns this directory.

- `api.ts` is the public `/viewer` contract; `registry.ts` holds browser registrations. Preserve API generation checks, cleanup contracts, stable descriptor ids and ordering.
- Built-in and contributed surfaces should use the same descriptor path. Avoid dependencies on editor/viewer/index internals when extending the platform.
- Host plugins are trusted; user plugins in the malleable sandbox have a distinct approval boundary. Do not bypass it.
- Document API changes in `docs/extension-api.md` and follow `docs/api-stability.md`; update public API and slot tests together.
- Use subscribed external snapshots in React and named hooks for effects. No manual memo in new code.
- All checks run on your own Boat. Coordinate with the platform owner before changing existing files.
