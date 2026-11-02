# Replay edits

`<replay id>/edits.json` is an optional, backwards-compatible sidecar. Existing lists with no `highlights` field keep
the same behavior. Every stored time is an integer number of milliseconds on the original replay timeline.

Trims and cuts change playback and video export timing. Zoom, speed-up, blur, and editor captions apply to playback
and video export. Cursor settings apply to the playback cursor and exported cursor. Point and period highlights are
navigation annotations: the viewer maps them through trim, cuts, and speed changes, and omits points in removed time.
A period crossing a cut appears as separate visible spans. Highlights are not drawn into exported videos.

See [edits.schema.json](edits.schema.json) for the version 1 JSON shape and [src/shared/edits.ts](../../src/shared/edits.ts)
for strict validation and normalization.
