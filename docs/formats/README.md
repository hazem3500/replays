# Data formats

Replays, comments, edits and user plugins are plain JSON documents. These JSON Schemas (draft 2020-12) describe the shapes that
tools, plugins and other systems can rely on. They are a *description* of what the app reads and writes (the server remains the
validator for sizes and the privacy pass), and `test/formats.test.ts` keeps them true by validating real files against them.

| Schema | Document |
| --- | --- |
| [`replay.schema.json`](replay.schema.json) | The replay bundle (`replay.json`) |
| [`context.schema.json`](context.schema.json) | `replay.context` |
| [`replay-summary.schema.json`](replay-summary.schema.json) | `<id>/meta.json` and each `GET /api/replays` item, including the poster's ThumbHash |
| [`expired-replay.schema.json`](expired-replay.schema.json) | `_expired/<id>.json`, what is left of a replay retention removed, and each `GET /api/expired-replays` item |
| [`data-storage.schema.json`](data-storage.schema.json) | Authenticated `GET /api/data-storage` policy and access-filtered trash |
| [`bulk-trash-request.schema.json`](bulk-trash-request.schema.json) | Explicit `POST /api/data-storage/trash` confirmation |
| [`bulk-trash-result.schema.json`](bulk-trash-result.schema.json) | Authorized bulk trash result counts |
| [`comments.schema.json`](comments.schema.json) | `<id>/comments.json` |
| [`edits.schema.json`](edits.schema.json) | `<id>/edits.json` (beta editor) |
| [`plugin-manifest.schema.json`](plugin-manifest.schema.json) | A user plugin's manifest (beta.malleable) |
| [`suite-plan.schema.json`](suite-plan.schema.json) | The plan `replays suite record --plan` reads (example: `sample/suite-plan.json`) |
| [`user-plugin.schema.json`](user-plugin.schema.json) | A shareable `*.replays-plugin.json` file |
| [`user-plugin-history.schema.json`](user-plugin-history.schema.json) | A saved plugin's version history |

Versioning: each format carries a `version` or `format` field. Changes are additive, or the version is bumped and the old one stays
readable ([../api-stability.md](../api-stability.md)). Design background: [../malleability.md](../malleability.md#data-as-the-stable-core).

See [edits.md](edits.md) for how saved edits, including viewer-only highlights, affect playback and video exports.
