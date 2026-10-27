# Main application runtime migration

This slice installs Agent-Native **0.220.0** in the normal `startServer` path. It mounts the published `mountActionRoutes` dispatcher on a real H3 **2.0.8** application, with an explicit read-only replay-metadata action at `GET /_agent-native/actions/inspect-replay?id=…`. It does not call an action's `.run()` as a substitute for dispatch. The selected Replays adapter authenticates the original Node request first; CSRF and host request hooks remain authoritative. No framework login, terminal, automatic action discovery or code-execution endpoint is mounted. `startServer({ application: false })` retains a portable HTTP-only library host.

This is an incremental migration of the main server, not completed application-wide adoption. The viewer's existing operation hooks, embedded conversational agent, message storage, provider selection, bounded model execution and durable background processing remain subsequent work. Conversation headers and application action receipts are implemented here; they are not a claim that a running framework chat or durable agent run exists.

## SQL and portable data

Set `DATABASE_URL` to a PostgreSQL URL to enable application records. No PGlite fallback is used for these records. The runtime uses the framework's published `createDbExec({ url })`, parameterized statements and transaction API. Startup applies additive `CREATE TABLE IF NOT EXISTS` migrations under its documented migration scope. Hosts should provision a dedicated database and migration-capable role; deployment-specific secret delivery is outside this change.

The tables are `replays_conversations`, `replays_runs` and `replays_agent_credentials`. Conversations are currently owner-scoped headers with a title, not an embedded chat's messages. Run rows record action name, status and timestamps without arguments, replay content, results or error strings. They are application receipts, not the framework's durable-run engine. No SQL replay index or blob migration is introduced. Replay bundles, media, comments, edits and saved sandboxed plugins remain canonical in the configured ObjectStorage. Existing portable data needs no conversion.

`REPLAYS_WORKSPACE_ID` is a deployment-owned constant, default `default`. SQL ownership combines it with the selected auth adapter name and the adapter's stable `Identity.id`; neither browser organization headers nor display email determine ownership. Changing any of these keys intentionally changes which SQL records a caller can see. Preserve those values during a deployment migration. Replay object access remains governed by the existing host's store and policies; this slice does not introduce per-recording SQL tenancy.

Without PostgreSQL, replay viewing and the metadata dispatcher work, and SQL-dependent capabilities report unavailable. Database setup failures fail startup without opening a listener. Rollback removes the runtime integration and leaves the additive SQL tables intact; it does not rewrite or delete recordings. Back up application SQL separately from ObjectStorage.

## Credential contract for host Settings

Set `REPLAYS_AGENT_CREDENTIALS=1` as well as `DATABASE_URL`, or pass `application: { credentials: true, databaseUrl }` to a programmatic host. Configuration defaults to off. Settings must fetch capabilities before offering generation:

- `GET /api/agent-capabilities` returns `runtime: 'agent-native'`, `conversations: { enabled }`, and `credentials: { enabled, scopes, maxExpirySeconds, requiresHostAuthentication: true }`.
- `GET /api/agent-credentials` returns `{ credentials }`, each with `id`, `name`, `scopes`, `createdAt`, `expiresAt` and `revokedAt` (epoch milliseconds).
- `POST /api/agent-credentials` accepts `{ name, scopes, expiresInSeconds }`, returning HTTP 201 `{ credential, secret }`. Display `secret` once. It cannot be fetched later.
- `DELETE /api/agent-credentials/:id` revokes an owned credential, returning HTTP 204. Unknown, other-user and other-workspace IDs return 404.

Every response uses `Cache-Control: no-store`. Only a SHA-256 digest of a cryptographically random 256-bit secret is stored. Names have at most 100 characters, expiry is 60 seconds to 30 days, and at most 20 unexpired, unrevoked credentials may exist per owner. PostgreSQL advisory transaction locking enforces this bound during concurrent creation.

Supported scopes are `replays:read`, `conversations:read` and `conversations:write`. Requests present the secret in `x-replays-agent-token`; the ordinary host authentication must also succeed and identify the same SQL owner. This header deliberately leaves the host's Authorization mechanism available. Credentials narrow that identity's access: they never replace the host adapter or bypass a proxy's authentication. A host that needs independently authenticating bearer credentials needs a separate explicit host-auth contract; this slice does not silently grant one.

Token requests are restricted before post-auth plugin hooks to the matching metadata action or conversation endpoint. They cannot manage credentials, mint human consent, save plugins, invoke legacy writes or call arbitrary framework operations. Revocation and expiry are checked on every request. The human Keep dialog and sandbox capability broker remain the only approval path.

`GET /api/agent-conversations` lists the current owner's most recent 100 conversation headers. `POST` creates one from `{ title }` (1–200 characters). These endpoints make SQL ownership testable without model credentials or production data.

## Validation

Run focused dispatcher and security tests with `pnpm exec vp test run --config vitest.config.ts test/agent-native-runtime.test.ts --maxWorkers=1`. PostgreSQL tests require a disposable local database: `REPLAYS_TEST_DATABASE_URL=postgresql://… pnpm exec vp test run --config vitest.config.ts test/agent-native-postgres.test.ts --maxWorkers=1`. Never point the test URL at production: the suite deletes its own fixed test workspace rows. Tests without this variable explicitly skip SQL coverage.

