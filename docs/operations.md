# Operations

## Deploying

The server is one Node process (`node --experimental-strip-types src/server/main.ts`, Node 22.12+). The Dockerfile
builds the viewer and runs the server as an unprivileged user on port 8080 with a `/data` volume:

```bash
docker build -t ghcr.io/hazem3500/replays .                                    # image without Chromium and ffmpeg
docker build -t ghcr.io/hazem3500/replays:render --build-arg WITH_RENDER=1 .   # + video export and list posters (Chromium, ffmpeg)
docker compose up --build                                       # see docker-compose.yml
```

Nothing in this repository pushes an image. If you publish one, see [releasing.md](releasing.md).

Put TLS in front (a reverse proxy, an ingress, a tunnel) and choose an auth adapter; `AUTH_MODE=none` on a reachable
address is logged as a warning on purpose. Health check: `GET /healthz` → `200 ok`, no auth.

Under a prefix (`BASE_PATH=/replays`) the process serves `/replays/…`; a proxy that strips the prefix before
forwarding works too.

### Several hosts, one process

`hosts` in the config file gives a host its own base; every other host keeps `basePath`:

```json
{ "basePath": "/tools/replays", "hosts": { "replays.example.com": { "basePath": "/" } } }
```

`https://replays.example.com/r/abc` and `https://intranet.example.com/tools/replays/r/abc` are then the same replay from
one process. The base is picked from the request's `Host` (port and case ignored). Host names are checked at start (plain
DNS names: no scheme, port, path or wildcard); a bad one stops the server with a message naming it. With any entry, every
response carries `Vary: Host` (index.html, redirects, upload receipts and `/api/config` included), so a shared cache never
serves one host's page to another. The host only shapes routes and links; access is decided by the auth adapter, the same
on every host. In `--dev`, Vite serves the page at the default base only.

Behind a gateway that rewrites `Host` to its own upstream name, set `TRUST_FORWARDED_HOST=true` (or
`"trustForwardedHost": true`): the base then comes from the last `X-Forwarded-Host` value, the one the nearest proxy wrote,
and `Vary` names both headers. Only turn it on when that proxy always sets the header itself; otherwise a client could pick
its own base (which changes links, never access).

### Static viewer on a CDN

`replays build-static --out site [--base /replays] [--config replays.config.ts]` copies the built viewer (`dist/client`,
from `pnpm build` or the installed package) to `site/` and stamps `index.html` exactly as the server would per request:
base path, product name, logo, theme tokens and `theme-color`, beta flags, comments and the plugins' browser entries.
`--base` defaults to the configured `basePath` (`BASE_PATH`); the environment applies as for `serve`. `render.html`, the
server-side render's page, is left out (`--include-render` copies it). From code: `buildStatic({ out, base })` from
`@hazem3500/replays/server`; `renderIndexHtml(html, options)` is the stamping alone.

The viewer still talks to the API at the base on the **same origin**: route `<base>/api/*` (and `<base>/_plugins/*`
when a plugin has browser entries) to the server, everything else to the bucket. On the bucket:

| Path | Cache-Control | Why |
| --- | --- | --- |
| `<base>/index.html`, and any page path that falls back to it | `no-cache` | It names the current asset hashes and carries the branding; revalidate on every load |
| `<base>/assets/*` | `public, max-age=31536000, immutable` | Content-hashed file names: a new build writes new names |

Serve `index.html` for unknown paths under the base (the viewer routes `/r/<id>` and `/s/<suite>` itself), for example
a "not found page" of `index.html` with status 200. Rebuild the static files when the branding, base or plugins change:
nothing is read at request time. Server-only features keep working through the API (video export, posters, comments).

## Storage and scaling

- `STORAGE=fs`: one instance per `DATA_DIR`. Back the directory up like any data volume.
- `STORAGE=s3`: several instances can share a bucket (uploads use create-only writes; suite registration uses
  compare-and-swap writes). Lists are cached for 5 s per instance.

## Retention

`RETENTION_DAYS` (default 30, `0` = never) counts from the *server's* upload time, never the client-supplied capture
time. A sweep runs at start, every six hours and (throttled) after uploads, and logs one line:
`retention sweep: removed N of M replays and K of L suites in T ms` — alert on that line going missing. **Kept**
replays and suites, replays attached to a kept suite, and the committed samples never expire. The app is the only
deleter; do not add a bucket lifecycle rule.

## Tracing (optional)

Set `OTEL_EXPORTER_OTLP_ENDPOINT` (any OTLP collector or backend) to export traces; unset, the OpenTelemetry SDK is
never even loaded. `OTEL_EXPORTER_OTLP_PROTOCOL` is `http/protobuf` (default) or `grpc`; the standard `OTEL_*`
variables (`OTEL_SERVICE_NAME`, `OTEL_TRACES_SAMPLER`, headers, …) apply. Spans carry route templates, methods, status
codes, replay/suite ids, sizes, counts and durations: never titles, URLs, recorded content, identities or error
messages. Incoming `traceparent` headers are continued. `OTEL_TRACES_EXPORTER=console` prints spans for a quick look.

## Video export and list posters (optional)

With Chromium and ffmpeg available (`WITH_RENDER=1` image, or `CHROMIUM_PATH` / `FFMPEG_PATH`), the viewer can render a
replay to MP4 and the index shows poster images and hover previews. Without them these features switch themselves off.
`RENDER_DISABLED=1` / `POSTERS_DISABLED=1` force them off. Rendering runs in a headless browser that can only reach a
loopback-only route guarded by a per-process token. In containers Chromium runs with `--no-sandbox`
(`CHROMIUM_NO_SANDBOX=1`) and relies on the container's isolation.

## Limits

Uploads: 25 MB of JSON (also after gzip decompression), 100 MB for an attached video, 64 KB for suite registrations.
Context: 16 KB. Performance entries: 500 per replay.
