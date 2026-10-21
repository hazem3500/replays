# Examples

| Example | What it shows |
| --- | --- |
| [`auth-signed-header/`](auth-signed-header) | An auth plugin that verifies a signed identity JWT forwarded by a proxy |
| [`custom-distro/`](custom-distro) | A runnable custom distribution on the extension surface: config file, plugin (auth, context adapter, branding, base path, hooks), browser entry (tab, action, panel) and an end-to-end smoke |
| [`s3-minio/`](s3-minio) | Docker Compose with MinIO as the S3-compatible storage backend |
| [`migrate/`](migrate) | A translation for `replays migrate` that converts stored replays from an older, downstream format |
| [`config/`](config) | A config file, a context JSON Schema and a matching context file |

Try the config example from a checkout:

```bash
REPLAYS_CONFIG=examples/config/config.json pnpm dev
pnpm capture --url https://example.com --output ./out \
  --context-file examples/config/context.example.json \
  --context-schema examples/config/context.schema.json \
  --upload-url http://localhost:3000/api/replays
```
