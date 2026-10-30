# Host plugin API

Read the root guide and `docs/extension-api.md`. This area and `src/client/plugins/` are owned by the extension-platform lane.

- `types.ts` defines public host contracts, `registry.ts` builds registrations (shape checks in `registration-checks.ts`, branding in `branding-collector.ts`, order in `order.ts`, merging in `registry-merge.ts`) and `index.ts` defines the package entry. Import shared contracts, not server internals.
- Preserve `PLUGIN_API_VERSION`, registration validation, plugin order and conflict handling. Follow `docs/api-stability.md` for additions, deprecations and breaking changes.
- Update extension docs, `test/public-api.test.ts` and relevant plugin contract tests with API changes.
- Host plugins are trusted server code. User-authored malleable plugins use the browser sandbox/approval path; do not grant them host privileges.
- Browser contracts are in `src/client/plugins/api.ts`. Keep host-only dependencies out of that public viewer entry.
- Verify registry, hook and distribution behavior on your own Boat; coordinate before editing active API work.
