# Migrating the downstream (internal distribution) onto the extension surface

The downstream is the internal, branded distribution of replays that predates the generalised upstream: its tree was the
starting point of this repository, and it kept growing product-specific parts in the same files. The goal of the extension
surface ([extension-api.md](extension-api.md)) is that it can drop its copy of the core, depend on `@hazem3500/replays` at a
pinned version, and keep only what is really its own: a config file, one or two plugins, a browser entry, and its deploy
infrastructure.

The design these steps build on is [architecture/extensibility.md](architecture/extensibility.md). This page is based on reading the downstream's `main` (merge commit `592ba0f`) against this repository. It names the
downstream only as "the downstream"; product, host and project identifiers stay in its own repository.

## 1. Where each downstream-only part goes

"Ready" means the extension surface in this repository covers it today. "Gap" means it needs upstream work first (section 6).

| # | Downstream-only part (as found) | Becomes | Lives in | Status |
| --- | --- | --- | --- | --- |
| 1 | **Auth coupling.** An identity-aware-proxy JWT verifier (ES256 against the proxy's published keys, exact audience, a company email domain, an allow-list of service accounts for the agent runner); `AUTH_MODE=iap` (default) and `dev`; `IAP_JWT_AUDIENCE`, `ALLOWED_GOOGLE_DOMAIN` | An auth plugin: `api.auth({ name: 'iap', create(env) })`. Start from [`examples/auth-signed-header`](../examples/auth-signed-header) (JWKS, issuer, audience, expiry, email domains and exact emails, which covers service accounts) or port the existing verifier unchanged. `dev` is the built-in `none` | downstream plugin | Ready |
| 2 | **Test-context adapter.** A typed, product-specific `context` (`app.product`/`environment`, `account`, `organization` with plan, flags and permissions, `test`), its validator, the capture-side collector, and the viewer's formatting (plan label, links into the product's admin console, a commit link) | A context adapter: `normalize` accepts the legacy typed shape and writes it to `context.fields`; `schema` titles and types the fields for the Context tab; admin-console and commit links are computed there as `format: "uri"` fields. Bespoke rendering beyond that is an inspector tab. The collector that *produces* the context stays in the downstream's capture tooling (on `@hazem3500/replays/capture`) | downstream plugin + capture tooling | Ready (stored data: `replays migrate`, G1) |
| 3 | **Chat, support and VCS source links.** Source kinds `slack-thread`, `crisp-ticket`, `github-pr`, `github-issue`, validated by host and path; brand marks in the source line, the topbar chip and the Context tab | Source-link providers: `api.sourceProvider({ id: 'slack', resolve })` and `id: 'crisp'` (the workspace host is checked in `resolve`); GitHub is the built-in `github` provider with `githubHost`. Producers send `{ provider, ref }` | downstream plugin | Ready for links; the brand marks are gap G4 (until then the chip shows the label) |
| 4 | **Branding and styles.** Product name, a purple/pink palette as design tokens, density and type scale, a logo | `branding` (name, `logoUrl`, `theme.dark` / `theme.light` over the documented tokens) in the config or a plugin. Anything beyond tokens goes in the client entry's `style` file. Contrast stays covered by a test over the downstream's palette (pattern: `test/contrast.test.ts`) | downstream config + assets | Ready |
| 5 | **Deploy workflow and infrastructure.** `deploy.yml` (gated, OIDC, tunnel, pinned host key), `image.yml`, the compose file, `scripts/deploy-*.sh`, the validation script, `docs/deploy.md`, environment protections and secrets | Unchanged. The image is built from the downstream repo: `COPY` the config, plugin and client bundle onto the upstream-built package (example in section 3) | downstream | Stays |
| 6 | **Slugs, domains and base path.** `BASE_PATH=/<slug>/<app-path>` behind a gateway that strips the slug; `ROOT_HOSTS` serving the same process at `/` on its own domain with `Vary: Host`; `TRUST_FORWARDED_HOST`; 301/308 redirects from old paths; a browser `GET /` redirected to the app | `basePath` in the config or `BASE_PATH`; the old-path redirects and the `GET /` redirect as a `pre-auth` `onRequest` hook (it sees every request except the health checks). The bare (prefix-stripped) shape is accepted by core, which is what the gateway needs | downstream config + plugin | Ready for one base path; the per-host base (`ROOT_HOSTS`) is gap G2 |
| 7 | **Cloud Storage backend.** `storage/gcs.ts`, `STORAGE=gcs`, `GCS_BUCKET` | `api.storage({ id: 'gcs', create({ env, dataDir }) })` returning an `ObjectStorage`. Run `describeObjectStorage` from `/server/testing` against it | downstream plugin | Ready |
| 8 | **Retention by purpose.** Days per purpose (`triage`, `design-review`, `walkthrough`, default) in `shared/retention.ts`; "kept" by a staff member | Upstream has one `RETENTION_DAYS` and the same *Keep* feature | – | Gap G3 |
| 9 | **Data-model deltas.** `meta.source` values, `meta.purpose`, source `kind`, the typed `context` | `prepareUpload` translates producers' bodies; `meta.tags` can carry the purpose (`purpose:triage`); `replays migrate` with the same translation converts stored replays (section 5) | downstream plugin + translation module | Ready |
| 10 | **Agent runner producers.** The capture CLI wrapper for the agent browser, the import path, the review-suite adapter | The upstream CLI already has the `agent-browser` driver, import and `ReviewSuiteAdapter`; the downstream keeps only a thin wrapper that adds its context and `--source` flags | downstream tooling | Ready |
| 11 | **Samples and dev fixtures.** `sample/*` demo replays, `dev/usecases/*` and the seed script | `SAMPLE_DIR` / `startServer({ sampleDir })` points at the downstream's own samples (or an empty directory) | downstream | Ready, stays |
| 12 | **Core-UI additions.** A person card page and a "For you" feed on the index, purpose chips and filters, haptic feedback settings | No extension point for index pages or global settings | – | Gap G4 |
| 13 | **Agent and design guidance.** `AGENTS.md`, `CLAUDE.md`, design plans, the use-case scripts | Unchanged | downstream | Stays |

## 2. What stays in the downstream repository

- Deploy infrastructure: workflows, compose files, scripts, runbooks, environment names and protections.
- Secrets and their wiring: the proxy audience, signing keys, storage credentials, SSH keys, registry tokens. Plugins read them from
  the environment (`api.env`), never from the config file.
- Branding assets and values: logo files, the palette, the product name, domains and slugs.
- Product-specific code: the collector that builds the product's test context, the context schema file, the chat and support link
  rules, the legacy-shape translation.
- Samples and fixtures.
- Its own tests: the plugin's unit tests, an end-to-end smoke like `examples/custom-distro/e2e`, the palette contrast check.

## 3. Target layout

The pending customer-forwarding branch is a separate trust boundary. If adopted, register a backend-only upload alias and use the same core upload pipeline:

```ts
api.uploadEndpoint({
  path: '/api/customer-recordings',
  prepare: ({ body, identity, request }) => normalizeCustomerRecording(body, identity, request),
});
```

The host owns authorization and normalization: the forwarder must be allowed by IAP **and** the customer-forwarder policy, and it must be refused on every other authenticated application route. Enforce that restriction in the verified auth adapter before built-in plugin hooks can answer; a later host post-auth hook alone does not cover every route. The alias gets no browser CORS exception. Generate the replay id server-side; set the human source and support purpose; discard producer people, privacy hints and suite attachment; replace context with the bounded, validated customer context. The result still passes normal validation, sanitization, upload hooks and storage. Do not copy the downstream HTTP handler into the host.

Test the forwarder's denied read/list/export/other-upload paths as well as successful forwarding. Retain staff upload and same-origin behavior. The pending branch's exact accepted envelope, metadata limits and service-account permissions need a final comparison when it lands.

### Staging privacy

The downstream can keep ordinary staging input values and `email`/`code` query parameters readable after checking the recorded page/step origins. Password and hidden inputs remain masked, including password visibility toggles.

**Initial migration decision: retain upstream's stricter sanitization.** Ordinary typed values and sensitive URL parameters therefore stay masked in staging too. Host redaction rules can add protection; they cannot restore data already removed by the core. This is a visible behavior difference to validate with staging users, not an equivalent implementation of the downstream's readable-staging policy. Customer recordings continue through the strict sanitizer regardless of producer hints. A future relaxed staging profile needs a separately reviewed, explicit trusted-host contract; do not implement it by bypassing the sanitizer in an upload hook.

### Playback, runtime and workspace changes

Pacing and replay fidelity are core behavior: preserve the latest downstream regression fixtures when validating real recordings. The host config can select `capture: { stepPauseMs: 1200 }` while the core keeps its existing zero-pause default. Shared caption/idle handling and the playback/export speed list belong upstream. Product-specific policy stays in config/plugins.

The refreshed downstream pins Node 22.23.4; align the package's image and CI patch pin and satisfy its type-stripping requirements. Compile published plugins to JavaScript: Node does not strip TypeScript from dependencies under `node_modules`. Keep the deployment's frontend and private renderer origins separate where required. Set `signIn: { path: '/api/sign-in' }` in the CDN host config; the path excludes the host base. The core normalizes return paths, probes refused API access and bounds automatic retry; network failures must remain network failures.

A pending monorepo reorganization changes host workspace/build wiring, not the extension contract. Its gateway and frontend should both depend on the same pinned package artifact. Check the final downstream workspace layout before preparing the later migration PR.

## Target host layout

```text
host/
  package.json                 exact dependency and committed lockfile
  replays.config.mjs           deployed auth/storage/theme/purposes/policy
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
3. **Add the host layer beside the old app.** Start from `examples/host-app`: config, theme, purposes, people, source/context plugins and compiled browser entry. Use a distinct staging data prefix and explicit local profile. Compare the pages without replacing the live app.
4. **Port producer normalization.** Exercise automated captures, human imports, review suites and staff browser uploads against the replacement. Verify default purposes, provenance, uploader identity, gzip/size/error behavior and duplicate replay handling. Preserve suite people during translation.
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

Adapt [`examples/migrate/translate.mjs`](../examples/migrate/translate.mjs) to the current producer fixtures. The translation must be idempotent and must retain the purposes/people supported by the target artifact.

```sh
replays migrate --from fs:/backup/replays --to fs:/tmp/converted \
  --translate ./translate.mjs --config ./replays.config.mjs --dry-run --report dry.json
replays migrate --from fs:/backup/replays --to gcs \
  --translate ./translate.mjs --config ./replays.config.mjs --report converted.json
replays migrate --compare --from fs:/backup/replays --to gcs \
  --config ./replays.config.mjs --report comparison.json
```

## 4. Migration steps

Each step ships on its own and can be reverted by redeploying the previous image. Do them in this order; the risky ones (auth,
storage, data) come after the neutral ones, and each has a staging check.

1. **Pin and vendor.** Choose how the downstream receives the package (gap G5; until a registry is chosen: build a tarball with
   `pnpm pack` from a tagged commit of this repository and add it as a file dependency). Add `@hazem3500/replays` at an exact version.
   Nothing uses it yet.
2. **Config and branding (rows 4, 6, 11).** Add `replays.config.ts` with name, logo, theme tokens, `basePath` and `sampleDir`. Keep the
   downstream's own server running with the same values; compare the pages side by side. This also proves the palette maps onto the tokens.
3. **Source providers and context (rows 2, 3, 9).** Write the plugin with the chat/support providers and the context adapter that
   accepts the legacy shape. Run the downstream's producers against a plugin-enabled upstream server in staging; stored output should
   equal what the old server stores, apart from the documented format changes.
4. **Auth (row 1).** Add the proxy-JWT auth plugin. In staging, verify: no header → `403`, wrong audience → `403`, wrong domain → `403`, the
   agent runner's service account → `200` on upload, health check public. Keep the old verifier's test vectors as the plugin's tests.
5. **Storage (row 7).** Add the storage plugin and run the contract tests. Point a staging instance at a copy of the bucket.
6. **Hooks (row 6).** Add the redirect hooks and check them with the gateway's real path rewriting (the doubled-prefix case in particular).
7. **Switch the image.** Build the image from the pinned package plus the downstream layer. Deploy to staging with the production
   data copy, run the downstream's use-case scripts, then production through the existing gated workflow.
8. **Delete the fork.** Remove the copied core (`src/server`, `src/shared`, `src/client`, `src/capture`, build config) from the
   downstream, in one commit, keeping only section 2's list.
9. **Convert stored replays (section 5).** Only after step 7 has soaked; keep the pre-conversion snapshot.

Rollback: before steps 7 and 9, snapshot the bucket or volume. Until step 9 the new server writes only upstream-format data
that the old code does not read, so step 7's rollback is "redeploy the previous image and restore the snapshot of anything uploaded
since"; plan the cut-over in a quiet window, or run the old server read-only against the same data until step 9.

## 5. Stored data and producers

- **New uploads.** `prepareUpload` and the context adapter translate the old shapes at the door, so existing producers keep working.
  Migrate producers to the upstream shapes at leisure, then delete the translation.
- **Existing replays.** Core validates `replay.json` on upload, not on read, and it ignores unknown `meta` keys, but it does
  not know the old `context` and `sources[].kind` fields. Convert them with `replays migrate`
  ([operations.md](operations.md#converting-stored-replays)): it reads every bundle and its sidecars from the old store (a plugin
  backend such as the Cloud Storage one works through `--config`), applies the translation module (start from
  [`examples/migrate/translate.mjs`](../examples/migrate/translate.mjs), which covers the deltas in row 9; share the function with
  the plugin's `prepareUpload`), validates, and writes create-only to a new store. Run it with `--dry-run` first, on a copy, then
  `--compare` the two stores' summaries.
- **Purpose.** Carry it as `meta.tags: ["purpose:triage"]` (the list filters by tag) until retention by purpose exists upstream (G3).

## 6. Gaps

These are not covered by the extension surface today. None is a blocker for steps 1-6; G3 gates steps 7 and 9 (G1 is done).

| ID | Gap | Why it matters | Proposed upstream work |
| --- | --- | --- | --- |
| G1 | The stored/uploaded replay format differs (`meta.source` values, `meta.purpose`, typed `context`, source `kind`). `prepareUpload` fixes uploads; stored data needs the converter | Existing replays and old producers | Done: `replays migrate` / `migrateStore()` with a translation module, see [operations.md](operations.md#converting-stored-replays) and [`examples/migrate`](../examples/migrate) |
| G2 | One base path per process. The downstream serves one process at a prefix for the gateway and at `/` on its own domain, chosen per request host | The two public shapes cannot share a process | `basePath` accepting a per-request resolver, or a host → base map in the config; responses that depend on it set `Vary: Host` |
| G3 | One retention window (`RETENTION_DAYS`) | Today the downstream keeps walkthroughs forever and triage/review for 90 days | A retention hook: `api.retention({ days(summary) })`, with *Keep* unchanged |
| G4 | No index-page or global-UI slots; no provider icons for source chips; plugin actions are in the More menu only | The person card, the "For you" feed, source brand marks and haptics cannot be plugins | Index sections and filters as slots on the browser API; an icon per source provider; `placement: 'bar'` for actions. Haptics is generic and could be upstreamed as a core setting |
| G5 | The package is private and unpublished, so there is no registry to pin against | Section 4 step 1 | Owner decision: a private registry (for example the repository's package registry) from the release workflow, or tarballs attached to releases. Nothing is published by this change |
| G6 | Closed: the storage and auth contract suites are exported as `@hazem3500/replays/server/testing` | – | Done |
| G7 | A `.ts` plugin cannot be loaded from `node_modules` (Node does not strip types there) | Plugins published as packages must ship JavaScript | Documented; nothing to change |
| G8 | The browser plugin API draws into DOM nodes; it does not share the viewer's React tree or component library | A plugin cannot reuse the viewer's buttons and dialogs | Acceptable for v1; revisit if several plugins want shared components |

## 7. Version pinning and upgrades

- Pin an exact version (`"@hazem3500/replays": "0.3.1"`) and commit the lockfile. Before 1.0 a minor release may break the surface
  ([api-stability.md](api-stability.md)), so upgrade deliberately, one minor at a time.
- Upgrade routine: read the CHANGELOG between the versions, bump on a branch, run the downstream's plugin tests and its end-to-end
  smoke, fix deprecation warnings (they are printed once at start), deploy to staging, then production.
- Automate the nudge, not the merge: a weekly dependency pull request for this one package.
- Keep `PLUGIN_API_VERSION` in mind: a plugin refuses to load, with both numbers named, when it meets a server of another generation.
