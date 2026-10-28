# Local demo seed

`scripts/demo-seed.mjs` writes six small, fictional replay bundles and three multi-run suites in the same formats used by local capture/import and suite storage. The examples cover a masked signup, checkout validation and order completion, dashboard search, network timeout and retry, settings diagnostics, and a longer team activity session. They use several reserved `.test` hosts, dates, tags, and suite statuses.

Each replay starts with a pre-action serialized DOM snapshot and contains timed rrweb incremental events through the declared duration: cursor positions and clicks for captured actions, masked form input events, and DOM text mutations for visible state changes. The last meaningful UI change is at the replay duration. Performance tracks are empty; the demo does not claim measured production performance. Console and network entries are illustrative fictional demo records. No external request is made and no customer or production data is included.

Generate an isolated, reusable copy:

```sh
node --experimental-strip-types --no-warnings scripts/demo-seed.mjs
# or choose a staging directory
node --experimental-strip-types --no-warnings scripts/demo-seed.mjs --output /tmp/replays-demo-seed
```

The output has `sample/*.json` and `data/_suites/*.json`. Repeating generation leaves identical files unchanged. A different file at a generated path causes a refusal; generation does not overwrite it or delete data.

For a new local preview, overlay only the additive seed files into its configured directories:

```sh
cp demo-seed-output/sample/*.json "$SAMPLE_DIR/"
mkdir -p "$DATA_DIR/_suites"
cp demo-seed-output/data/_suites/*.json "$DATA_DIR/_suites/"
```

If the app uses the default directories, set `SAMPLE_DIR=sample` and `DATA_DIR=.data/replays`. If suite run summaries are loaded from uploaded storage, also copy each sample replay to `"$DATA_DIR/<replay-id>/replay.json"`.

## Refresh an existing preview safely

Use this only after the six replay files and three suite files have already been overlaid. It replaces the known demo IDs with the current generated content, including optional uploaded copies at `DATA_DIR/<replay-id>/replay.json` when present:

```sh
node --experimental-strip-types --no-warnings scripts/demo-seed.mjs \
  --refresh-preview \
  --sample-dir "$SAMPLE_DIR" \
  --data-dir "$DATA_DIR"
```

Refresh preflights every required replay and suite before writing anything. Each replay must pass the replay schema and have the expected ID, `demo` and `synthetic` tags, `context.fields.demo === true`, `context.fields.fictional === true`, and `context.app.environment === "demo"`. Each suite must pass its schema, have the expected ID, and carry the same demo context markers. Optional uploaded copies must pass the replay checks too. Missing targets, symlinks, malformed files, unexpected IDs, or missing markers stop refresh. Unrelated filenames and all unrecognized uploaded records are left alone. Refresh creates no directories and deletes no files.

The paths must be the actual configured `SAMPLE_DIR` and `DATA_DIR`; refresh does not guess storage locations. The known ID set in the script is deliberately fixed so the command cannot sweep customer records.

## Comparison suites

`scripts/demo-comparison-seed.mjs` adds four suites built from the demo checkout recording, re-timed per run, for comparing recordings in the viewer: `demo-compare-performance` and `demo-compare-design` (Before and After), `demo-compare-browsers` (four runs) and `demo-compare-nightly` (six runs). Their performance entries are synthetic examples, not measurements. It writes into the same output layout, next to the demo seed's files:

```sh
node --experimental-strip-types --no-warnings scripts/demo-comparison-seed.mjs --output /tmp/replays-demo-seed
```

Overlay them the same way, then open `/s/demo-compare-performance`, or compare any two recordings with `/r/<id>?with=<id>&layout=grid`.

## Demo comments

`scripts/demo-comments.mjs` gives replays a few fictional review comments (a whole-replay note, threads with replies, a resolved thread and reactions), so the Comments tab and the seek-bar markers have a populated state. It writes `DATA_DIR/<replay-id>/comments.json` only for replays that have no comments yet, and times each comment as a fraction of the replay's duration:

```sh
node scripts/demo-comments.mjs --data-dir "$DATA_DIR" --sample-dir "$SAMPLE_DIR" demo-seed-checkout-error demo-seed-dashboard-search
```

Leave at least one replay without comments to see the empty state.
