# host-app

A small company distribution: `@hazem3500/replays` plus a config, one trusted server plugin, one trusted browser plugin and a theme.
All toolkit imports use public package subpaths. No core source, private hostnames, buckets or directory records are copied here.

## Run locally

From the repository root, using Node 22.18+ and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm build:cli
pnpm --filter @hazem3500/replays-example-host-app build
DEV_USER=reviewer@example.com pnpm --filter @hazem3500/replays-example-host-app start:local
```

Open `http://127.0.0.1:8080/replays/`. Local mode explicitly selects filesystem storage and `auth: 'none'`; it needs no cloud
credentials. Data is stored under the example's `.data/` unless `DATA_DIR` is set. `DEV_USER` is a local identity convenience;
`x-dev-user` also works with the core's local adapter. Keep this mode bound to loopback.

The browser build follows `custom-distro`: esbuild resolves the public `/viewer` entry into `dist/client.js`, and the server plugin
serves it and `dist/style.css` through `api.client`. The package itself supplies the built viewer. The server entry fixes config
discovery to this directory; `REPLAYS_CONFIG` can intentionally select a replacement config.

## Deploy behind IAP

`pnpm --filter @hazem3500/replays-example-host-app start` defaults to the deployed profile: real `/plugins/iap` and `/plugins/gcs`.
It fails if required settings are missing; it never falls back to local auth. Supply your deployment settings through its environment:

| Variable | Meaning |
| --- | --- |
| `HOST_APP_PROFILE` | `deployed` (default) or `local` |
| `IAP_JWT_AUDIENCE` | Exact IAP backend-service or App Engine audience |
| `IAP_ALLOWED_DOMAINS` | Allowed staff domains, such as `example.com` |
| `IAP_SERVICE_ACCOUNTS` | Exact uploader service-account emails; the proxy must also grant them access |
| `GCS_BUCKET`, `GCS_PREFIX` | Deployment-owned private bucket and optional key prefix |
| `GOOGLE_OAUTH_ACCESS_TOKEN` | Optional access token; otherwise GCS uses the attached workload's metadata credentials |
| `HOST_APP_STAFF_DOMAIN` | Staff email domain for people validation; default `example.com` |
| `HOST`, `PORT`, `PUBLIC_ORIGIN` | Bind address, port and public origin; deploy behind the authenticated gateway |
| `HOST_APP_STAFF_UPLOAD_ORIGINS` | Optional comma/space-separated exact origins allowed to POST `/api/replays` from a staff browser |

The runtime service account needs access to the configured bucket. The bucket stays private: the authenticated server streams
replays. Production values belong in deployment configuration, never in this example. Outside the monorepo, replace `workspace:*`
with an exact released version or immutable package tarball that includes these extension APIs, and retain the lockfile.

`/replays` is the fallback mount; `replays.example.com` serves the same process at its root. Change that neutral host for your
deployment. `trustForwardedHost` is false; enable it only for a gateway that replaces untrusted forwarded host headers. Hosts select
mount paths, not access control. IAP still authenticates each request. Core environment settings override config (including
`AUTH_MODE`, `STORAGE`, `BASE_PATH`, retention and editing); review the deployed environment with the config when promoting a release.

The deployed config declares `signIn: { path: '/api/sign-in' }` explicitly so static/CDN builds can stamp sign-in recovery metadata;
the core handles normalized return paths and authenticated probes. Local auth disables it. Capture uses `capture: { stepPauseMs: 1200 }`
for readable automated walkthrough pacing; producers can override this with `--step-pause`.

## What the host contributes

The config declares Triage (90 days, open before the first error), Design review (90 days, collapsed inspector) and Walkthrough
(0 means keep explicitly classified walkthroughs forever, with captions). `RETENTION_PURPOSE_TRIAGE_DAYS`,
`RETENTION_PURPOSE_DESIGN_REVIEW_DAYS` and `RETENTION_PURPOSE_WALKTHROUGH_DAYS` override those windows. Recordings without a purpose
use 90 days. A person's **Keep** choice still overrides retention; inferred purposes cannot make a recording permanent.

`src/plugin.ts` validates staff responsibility roles while allowing external customer participants as requester/mentioned, declares a
staff handle and profile/avatar links, and enriches names from authenticated email without changing identity IDs. Its context adapter
stamps the authenticated uploader, validates product environment/feature flags and supplies viewer widget hints. Its support provider
turns `SUP-42` into `https://support.example.com/tickets/SUP-42`. A summary field and matching server filter drive the browser's
Environment column and Customer sessions switch. The browser plugin adds a **For you** section for email-matched participants in the
current list, a Handoff inspector tab and customer handling context. Core **For me** also supports linked handles and role priority.
Theme tokens work in both colour schemes; extra CSS is scoped to the host section and uses those tokens.

For customer sessions, `beta.editor: true` retains saved-edit playback and MP4 export while `editing: { enabled: false }` blocks edit
writes. Posters, opening stills and hover previews keep their core as-recorded behavior. The outer beta flag alone cannot express
that behavior. `EDITING_ENABLED` overrides the config, and `/api/config` reports
the effective write policy. User plugins have a separate policy: personal scope only, comments writes and downloads denied, with
the built-in Context and host Handoff inspector surfaces locked. This policy restricts sandboxed plugins; trusted host code still
runs in the page/server. It is not a general API authorization system, and built-in comments remain available.

The core sanitizer stays strict in every environment, including staging: typed values remain masked. The host only adds redaction
rules for its session header, invite token, secret JSON field and private DOM selector. It does not weaken the privacy pass.

### Optional intake

By default, only the standard same-origin upload API is configured. Setting `HOST_APP_STAFF_UPLOAD_ORIGINS` registers a request
policy for canonical `/api/replays`, method POST, exact supplied origins and `content-type`/`content-encoding` headers, with credentials. Authentication
still applies; the gateway must also allow the desired browser traffic. This does not enable cross-origin access to other routes.

Backend-only customer forwarding is deliberately unconfigured. A future host plugin can use `api.uploadEndpoint`, but a post-auth
request hook cannot restrict a forwarder across every built-in plugin route. Isolate a forwarder in an auth adapter wrapping public
`iapAuth`: after cryptographic verification, allow its exact identity only on the original mounted intake path and POST method before
any request hooks run. Keep customer-browser traffic behind its backend and pass translations through the standard validation and
privacy pipeline. Do not add a broad origin exception or trust raw identity headers.

## Smoke test

```sh
pnpm test:host-app
```

This builds the toolkit and host package, checks the host against installed public declaration files, and starts a real server with
the local profile and temporary storage. The focused smoke checks theme/purposes/policy, uploads and privacy, people/identity,
summary filtering, and imports the actual served browser module to execute its registrations and Environment renderer. It requires
neither a browser install nor cloud credentials. It does not verify production IAP signatures or GCS connectivity; those adapters have
their own contract suites and should be checked against the deployment in staging.

## Upgrade and rollback

Pin the toolkit artifact and the distribution version together; build and run the smoke before promoting an image. Compare purpose
retention, effective editing policy, authentication and a sample of replay/context/people responses in staging. Back up storage and
trial data migrations on a copy before running them on the live bucket.

Rollback by redeploying the previous image **and its config/environment**, keeping the same storage. Remove optional intake by
clearing its origin list. Removing the company plugin hides its UI contributions; core recordings and plain context/summary
data remain readable. Retention deletions cannot be undone by a code rollback; recover them from your storage backup/versioning
policy. Host config/plugins are deploy-time code; sandboxed user plugins keep their own in-app version history.
