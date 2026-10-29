# Migrating an internal distribution to a thin host

The downstream should depend on a pinned `@hazem3500/replays` artifact and keep its config, plugins, assets, producers and deployment infrastructure. It should carry no copied capture, server, shared-format or viewer source. The [architecture](architecture/extensibility.md) describes the contracts; [`examples/host-app`](../examples/host-app) demonstrates the composition.

This mapping was refreshed on 2026-10-24 against downstream `main` **`4390e7a5be81453e6e4f311dd9f0b1b006c082c6`**, replacing the earlier `592ba0f`/`d5ab184` audit. The old local workspace is not the deployed source. Customer forwarding and workspace restructuring remain separate pending downstream changes; do not treat their branch heads as production behavior.

Implementation status is tracked by the architecture roadmap and linked pull requests. An extension described here must be present in the artifact selected for migration; an open PR is not a released package.

## What moves where

| Downstream behavior | Thin host implementation | Migration check |
| --- | --- | --- |
| IAP JWT authentication, domain and service-account allowlists | `/plugins/iap`, selected with `auth: 'iap'`; explicitly select `none` only in the local profile | Missing, forged, expired, wrong-issuer/audience and unlisted-account assertions fail; staff and listed runner accounts succeed |
| Browser sign-in redirect | Adapter sign-in metadata plus host `signIn` configuration and generic failed-fetch recovery; API requests retain machine-readable refusals | Preserve query/deep links; avoid redirect loops; never redirect uploads or renderer calls to a sign-in page |
| GCS persistence | `/plugins/gcs`, a private bucket/prefix and workload credentials supplied through the environment | Run exported storage contracts, including create-only and conditional-write conflicts |
| Profiles, profile retention, initial viewer position and poster moment | Config `profiles`, or `api.profile` for inference; `api.retention` for other rules | Preserve explicit versus inferred profiles, keep markers and per-profile expiry |
| People, identity enrichment and “For you” | `api.people`, `api.identity`, core replay/suite people and a browser index section | Check roles, handles, signed-in email and suite people after conversion |
| Product context, flag chips and admin links | A context adapter/schema plus `registerContextSection` for bespoke rendering | Preserve the typed values under `context.fields`; validate producer fixtures |
| Chat, support and VCS provenance | Source providers with `icon`, `noun` and bounded `attrs` | Preserve references, resolve only accepted hosts/paths and retain accessible labels |
| Branding and preferences | Name/logo/theme tokens, a host client stylesheet and `registerSetting` | Compare light/dark contrast, mobile layout and persisted settings |
| Index metadata and filters | `api.summaryFields`, `api.indexFilter`, browser columns/filters/sections | Derive fields on the server; filters must cover the full result set |
| Header actions and timeline tracks | Browser action/panel/tab/track registrations | Check navigation, source-time seeking and keyboard interaction |
| Gateway prefixes, own-domain root and old URLs | Config `basePath`, `hosts`, `trustForwardedHost` where the gateway is trusted, plus redirect hooks | Exercise both full and stripped prefixes through the real gateway; check `Vary` and returned replay URLs |
| CDN viewer and server renderer | `replays build-static` for the frontend; package server/render service on the gateway's private origin | Route API, plugin assets, auth and internal renderer traffic correctly; validate an MP4, preview and poster |
| Staff app browser uploads, merged in the refreshed snapshot | Route-scoped `api.requestPolicy` for authenticated `POST /api/replays`, exact allowed origins, requested headers and credentialed CORS | Preflight works without a sign-in assertion; actual uploads still authenticate; refusals carry CORS; unrelated methods/routes keep their CSRF checks |
| Capture pacing and shared playback/export speeds | Host `capture: { stepPauseMs: 1200 }`, optional `--step-pause`, core caption/idle handling and a shared speed list including 0.25× | Validate labels omit typed secrets; held captions retain the active rail step number; viewer and MP4 frame timing agree |
| Disabled edit writes, merged in the refreshed snapshot | `editing: { enabled: false }`, with `beta.editor: true` retaining saved-edit support | Hide edit controls and reject PUT before parsing; GET/HEAD/304, saved playback and MP4s still use existing edits; list media remain as recorded |
| Legacy producer payloads | `prepareUpload` plus context/source translation | Run all current producers against the replacement server before switching |
| Future backend customer recording intake | Optional `api.uploadEndpoint` and host authorization/normalization plugin; **no customer endpoint is enabled by default** | Review the pending downstream contract independently, as described below |
| Deploy workflows, workload identities, secrets, environment protections, samples and producer wrappers | Stay in the downstream repository | Preserve the existing deployment approval and rollback path |

The package remains a single version with public subpath exports. The host imports `/config`, `/plugin`, `/viewer`, `/capture`, `/server`, `/server/testing` and opt-in `/plugins/*`; it never imports `src/` or bundles its own replacement core.

## Decisions for the newer downstream changes

### Recording intake

A request policy is scoped to a canonical path, method and exact origin. Paths omit the deployment's base prefix:

```ts
api.requestPolicy({
  path: '/api/replays',
  methods: ['POST'],
  origins: ['https://app.example.com'],
  headers: ['content-type'],
  credentials: true,
});
```

This enables a narrow preflight/CORS and CSRF exception; it does not authenticate the upload or give a caller access to any other endpoint. Keep allowed origins in host configuration. Do not add a global CORS header or disable same-origin checks globally.

The host plugin can assign the staff intake's default profile and uploader person. Preserve explicit profiles and existing people. Trusted identity comes from the auth adapter, not a producer-supplied email.

The pending customer-forwarding branch is a separate trust boundary. If adopted, register a backend-only upload alias and use the same core upload pipeline:

```ts
api.uploadEndpoint({
  path: '/api/customer-recordings',
  prepare: ({ body, identity, request }) => normalizeCustomerRecording(body, identity, request),
});
```

The host owns authorization and normalization: the forwarder must be allowed by IAP **and** the customer-forwarder policy, and it must be refused on every other authenticated application route. Enforce that restriction in the verified auth adapter before built-in plugin hooks can answer; a later host post-auth hook alone does not cover every route. The alias gets no browser CORS exception. Generate the replay id server-side; set the human source and support profile; discard producer people, privacy hints and suite attachment; replace context with the bounded, validated customer context. The result still passes normal validation, sanitization, upload hooks and storage. Do not copy the downstream HTTP handler into the host.

The adapter can confine the forwarder declaratively: return its identity with `capabilities: { routes: [{ method: 'POST', path: '/api/customer-recordings' }] }`. The core then refuses every other route right after authentication. The path is canonical, so one entry covers every base path and gateway prefix. An existing wrapper that returns `undefined` for other paths keeps working unchanged. Server-chosen ids, the forced profile and source, and dropped people or suite data can live in the endpoint's `prepare` (raw body) or `normalize` (validated bundle); both run before the privacy pass ([custom upload endpoints](extension-api.md#custom-upload-endpoints)).

Test the forwarder's denied read/list/export/other-upload paths as well as successful forwarding. Retain staff upload and same-origin behavior. The pending branch's exact accepted envelope, metadata limits and service-account permissions need a final comparison when it lands.

### Staging privacy

The downstream can keep ordinary staging input values and `email`/`code` query parameters readable after checking the recorded page/step origins. Password and hidden inputs remain masked, including password visibility toggles.

**Initial migration decision: retain upstream's stricter sanitization.** Ordinary typed values and sensitive URL parameters therefore stay masked in staging too. Host redaction rules can add protection; they cannot restore data already removed by the core. This is a visible behavior difference to validate with staging users, not an equivalent implementation of the downstream's readable-staging policy. Customer recordings continue through the strict sanitizer regardless of producer hints. A future relaxed staging profile needs a separately reviewed, explicit trusted-host contract; do not implement it by bypassing the sanitizer in an upload hook.

### Playback, runtime and workspace changes

Pacing and replay fidelity are core behavior: preserve the latest downstream regression fixtures when validating real recordings. The host config can select `capture: { stepPauseMs: 1200 }` while the core keeps its existing zero-pause default. Shared caption/idle handling and the playback/export speed list belong upstream. Product-specific policy stays in config/plugins.

The refreshed downstream pins Node 22.23.4; align the package's image and CI patch pin and satisfy its type-stripping requirements. Compile published plugins to JavaScript: Node does not strip TypeScript from dependencies under `node_modules`. Keep the deployment's frontend and private renderer origins separate where required. Set `signIn: { path: '/api/sign-in' }` in the CDN host config; the path excludes the host base. The core normalizes return paths, probes refused API access and bounds automatic retry; network failures must remain network failures.

A pending monorepo reorganization changes host workspace/build wiring, not the extension contract. Its gateway and frontend should both depend on the same pinned package artifact. Check the final downstream workspace layout before preparing the later migration PR.

### Renaming purposes to profiles

Purposes are now called profiles. Nothing breaks on upgrade: every old name is a deprecated alias for at least two minor
releases and 90 days ([the list](api-stability.md#deprecated-purpose-names)). Move over in this order, one PR each if that is easier:

1. **Config.** Rename the `purposes` key to `profiles` and any `RETENTION_PURPOSE_<ID>_DAYS` variable to
   `RETENTION_PROFILE_<ID>_DAYS`. The start-up log stops warning about them.
2. **Plugins.** `api.purpose(...)` becomes `api.profile(...)`; type imports `PurposeConfig` / `PurposeDefinition` /
   `PurposeInferInput` become `ProfileConfig` / `ProfileDefinition` / `ProfileInferInput`. A `posterAt` hook reads
   `context.profile`. `normalize` and `prepare` hooks that force a purpose set `meta.profile` (setting `meta.purpose` still
   works and is stored as `meta.profile`).
3. **Producers and readers.** Pass `--profile` instead of `--purpose`, and `?profile=` instead of `?purpose=`. Code that reads
   API summaries reads `profile`/`profileInferred`; code that reads `GET /api/config` reads `profiles`; code that reads the
   bundle response reads `x-replay-profile`. Stored `replay.json` files keep `meta.purpose` and need no migration: the
   server and viewer read it as the profile.
4. **Links.** Saved index links with `?purpose=<id>` keep opening the same tab; new links use `?profile=`.

### Server-rendered pages

Pages now come from the TanStack Start build in `dist/start` (shipped in the package), rendered inside the same
`startServer()` process: nothing to change in a host or distro. The index's lists are fetched in process through the
host's own auth adapter and plugin hooks, with the visitor's credentials. Set `REPLAYS_SSR=0` to keep serving the
stamped `index.html`, for example while checking a custom browser plugin that expected an empty page at startup.

## Target host layout

```text
host/
  package.json                 exact dependency and committed lockfile
  replays.config.mjs           deployed auth/storage/theme/profiles/policy
  replays.local.config.mjs     explicit local fs/none profile
  context.schema.json
  src/server.mjs               startServer entry
  src/plugin.mjs               context, sources, people, intake and legacy translation
  src/client.ts                optional index/viewer contributions
  dist/client/                 built host browser entry
  assets/                     logo and stylesheet
  sample/                     host fixtures
  Dockerfile
  .github/workflows/           existing deployment infrastructure
```

Use the runnable example's build and entry points rather than copying the package's source. Keep deployment identifiers and secrets in the downstream; neutral examples use `example.com`.

## Migration steps for the later downstream PR

Each step must be reviewable and reversible. Do not change the downstream in this upstream implementation thread.

1. **Freeze the comparison.** Record the current downstream main SHA, deployed image and pending PRs. Inventory producers, routes, bucket prefixes, users and storage sidecars. Re-run this mapping if main advances.
2. **Choose an immutable artifact.** Build a tarball from the tested upstream commit/tag and pin its content/checksum, or pin an exact published release when available. The package is currently private/unpublished; a registry version shown in examples is not proof that it exists. Commit the host lockfile.
3. **Add the host layer beside the old app.** Start from `examples/host-app`: config, theme, profiles, people, source/context plugins and compiled browser entry. Use a distinct staging data prefix and explicit local profile. Compare the pages without replacing the live app.
4. **Port producer normalization.** Exercise automated captures, human imports, review suites and staff browser uploads against the replacement. Verify default profiles, provenance, uploader identity, gzip/size/error behavior and duplicate replay handling. Preserve suite people during translation.
5. **Validate auth and routing.** Test the IAP allow/deny matrix, browser sign-in/deep links, health checks, forwarded hosts, CDN paths, gateway prefix rewriting and private renderer origin. Test allowed staff-origin preflight/upload and refused origins/methods/headers. Keep backend-only forwarders out of unrelated routes if customer intake is adopted.
6. **Validate saved edits and rendering.** Disable edit writes while leaving saved edits active. Confirm PUT 403, GET/HEAD/304, viewer trim/cuts/effects and MP4 variant behavior. Posters, opening stills and hover previews continue to show the recording as captured. Compare pacing on real multi-navigation and user recordings.
7. **Rehearse data conversion on a copy.** Snapshot the source. Run `replays migrate --dry-run`, then convert into an empty destination prefix using the same legacy translator and host config. Preserve replay ids, suites, people, comments, edits, keep markers, plugin data and the original server upload age used for retention. Do not substitute the producer-controlled recording timestamp for trusted upload age. Rebuild summaries from converted bundles and regenerate derived media if sanitization changes the underlying content. Source `session.mp4` is dropped by default because the sanitizer cannot clean its pixels; the public migration API can opt into `sourceVideo: 'copy-if-unchanged'` only for an unchanged bundle after review. Never perform the first rehearsal against the live destination.
8. **Compare and smoke the converted store.** Review the migration report, `--compare` summary differences and explicit sidecar checks. Open representative old/new replays and suite links; inspect retention and privacy. Summary equality alone does not prove comments, edits or rendered frames are correct.
9. **Build and stage the thin image.** Use only the pinned artifact plus host files. Run the existing downstream use-case scripts, adapter/plugin tests, palette checks and browser smoke. Confirm the staging privacy difference explicitly before cutover.
10. **Cut over with a write plan.** Quiesce uploads or use a deliberate producer cutover, take the final snapshot/delta and deploy through the existing gated workflow. Keep the old image and untouched source prefix available. Do not let old and new servers write incompatible formats into one prefix.
11. **Delete copied core source last.** After staging and production validation, remove the copied capture/server/shared/viewer directories and redundant core build files. Keep host config/plugins/assets/producers/deploy files and their tests. Verify there are no imports into an upstream `src/` path.
12. **Upgrade deliberately.** Bump one pinned artifact at a time, read the changelog, run host contracts and smoke tests, stage and then deploy. Host changes roll back by artifact/config version; sandboxed user plugins keep their in-app history and review notices.

Rollback uses the old image **and its matching source data snapshot/prefix**. Before enabling writes after a cutover, decide how new uploads will be retained or replayed if rollback is needed. Redeploying an old image alone does not make new-format writes readable.

## Conversion commands and remaining boundaries

Adapt [`examples/migrate/translate.mjs`](../examples/migrate/translate.mjs) to the current producer fixtures. The translation must be idempotent and must retain the profiles/people supported by the target artifact.

```sh
replays migrate --from fs:/backup/replays --to fs:/tmp/converted \
  --translate ./translate.mjs --config ./replays.config.mjs --dry-run --report dry.json
replays migrate --from fs:/backup/replays --to gcs \
  --translate ./translate.mjs --config ./replays.config.mjs --report converted.json
replays migrate --compare --from fs:/backup/replays --to gcs \
  --config ./replays.config.mjs --report comparison.json
```

Writes are create-only; a different document already present in the target is a conflict to investigate. Expected translation differences need review rather than a blanket requirement for identical summaries.

Remaining deliberate boundaries are package distribution until a release mechanism is selected, stricter staging sanitization, the pending customer-forwarding contract, and the pending downstream workspace layout. The browser plugin API uses DOM nodes rather than sharing the core React tree; host plugins own their markup and lifecycle. These boundaries must remain visible in the downstream PR rather than being papered over by copied source.
