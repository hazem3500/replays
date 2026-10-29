# Converting stored replays

[`translate.mjs`](translate.mjs) is a translation for `replays migrate`: it converts the stored format of a distribution
that predates the upstream shapes (`meta.source: 'toki'`, `meta.profile`, a typed `context`, `context.sources[].kind`).
Copy it into your own repository and adjust it to your deltas. Each step leaves an already-converted document unchanged.

```bash
# What would change, without writing anything
replays migrate --from fs:/backup/replays --to fs:/tmp/converted --translate ./translate.mjs --dry-run --report dry.json
# Convert, then compare the list summaries of the two stores
replays migrate --from fs:/backup/replays --to gcs --translate ./translate.mjs --config ./replays.config.mjs --report run.json
replays migrate --compare --from fs:/backup/replays --to gcs --config ./replays.config.mjs
```

See [docs/operations.md](../../docs/operations.md#converting-stored-replays) for the whole procedure.
