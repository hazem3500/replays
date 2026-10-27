# App-key ingest example

A public, write-only upload endpoint that apps call directly with an app key, built only from the
[custom upload endpoint](../../docs/extension-api.md#custom-upload-endpoints) hooks. Nothing here is in the core;
copy `plugin.ts` into your host and adapt it.

```ts
import { appKeyIngest } from './app-key-ingest/plugin.ts';

export default defineConfig({
  plugins: [
    appKeyIngest({
      apps: [
        {
          id: 'focus',
          keys: [process.env.FOCUS_INGEST_KEY!, process.env.FOCUS_INGEST_KEY_NEXT!].filter(Boolean),
          origins: ['https://app.example.com'],
          retentionDays: 30,
        },
      ],
      // Behind a load balancer that appends the client address:
      clientIp: (request) => String(request.headers['x-forwarded-for'] ?? '').split(',').at(-1)?.trim() || 'unknown',
    }),
  ],
});
```

What it does with each hook:

| Hook | Use |
| --- | --- |
| `requestPolicy` | CORS for the union of every app's origins, with `content-type`, `content-encoding` and the key header. Credentials stay off. |
| `uploadEndpoint.authenticate` | Per-IP limit, then a constant-time key match. A disabled app or a disallowed origin gets `403`, and a missing `Origin` is refused unless `allowServerSide` is set. Two keys per app allow rotation. |
| `uploadEndpoint.rateLimit` | Per-key limit, answered `429` with `Retry-After`. |
| `uploadEndpoint.maxBytes` | A per-app cap, checked against `Content-Length`, the stream and the gunzipped size. |
| `uploadEndpoint.normalize` | Server-chosen id, `human` source, an `app:<id>` tag. Drops client people, purpose, suite membership and context. The core privacy pass still runs afterwards. |
| `uploadEndpoint.receipt` | `{ id, reference, replayUrl }`. `replayUrl` stays behind staff auth. |
| `retention` | Per-app `retentionDays`, found by the `app:<id>` tag. |

The endpoint's identity is confined to `POST` on its path, so an app key never reads, lists, edits, deletes,
comments or touches media. Exempt exactly the endpoint path from your staff gateway (for IAP, a path rule for
`/api/ingest/v1/recordings` under your base path); every other route stays behind it.

The counters live in process memory. With more than one replica, each counts separately; put a shared store
behind the same limiter shape. The plugin logs one JSON line per accepted or refused request, without payloads.
