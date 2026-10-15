# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project aims to follow [Semantic Versioning](https://semver.org/) once it reaches 1.0.

## [Unreleased]

### Added

- **Comments.** Comment on a whole replay or pin a comment to a moment: markers on the seek bar with a hover card, a
  Comments tab that follows the playhead, threads, resolve, author-only edit and delete, emoji reactions, comment
  permalinks (`#comment-<id>` with `?t=`) and the `M` shortcut. Times are stored on the source timeline and mapped
  through saved edits when the beta editor is on; comments in trimmed or cut stretches are listed as "In removed
  section". Authors come from the auth adapter (new optional `Identity.avatarUrl`; OIDC `picture`), anonymous with
  `AUTH_MODE=none`. Stored as `<id>/comments.json` on the filesystem or S3 driver (deleted with the replay), rate
  limited and length limited. On by default; `REPLAYS_COMMENTS=false` removes the UI and the API answers 404.
- **Replay editor (beta, off by default).** Non-destructive edit mode: trim, cuts, "Remove waits", speed-ups, zoom
  regions, blur boxes and captions, stored as an edit list next to the replay and honoured by playback and video exports.
  Enable with `REPLAYS_BETA_EDITOR=true` or `beta.editor` in the config file; with the flag off there is no editor UI,
  the edits API answers 404 and the editor code is not loaded.

### Security

- Relative `srcset` / `imagesrcset` candidates and CSS `url()` values (relative ones too) are redacted like other
  URLs, and suite and run registrations go through the same privacy pass as replay uploads.

### Changed

- The suite index is built from the replay list instead of three lookups per run.

## [0.1.0] - Unreleased

First public-shaped version, extracted and generalised from an internal debugging tool.

### Added

- Capture CLI (`replays capture`): records a page with scripted steps into one `replay.json` (rrweb events,
  agent steps, console, sanitized HAR network track, performance) with an optional MP4; Playwright driver by default,
  `agent-browser` driver optional.
- Recorder as a library (`RecorderSession`) usable from any CDP connection, including a Playwright test.
- Self-hostable server: upload API, retention, "keep" pins, suites of runs, optional server-side video export and
  list posters, optional OpenTelemetry (OTLP) tracing.
- Viewer: one transport, error markers, synced Console / Network / Performance / Context tabs, permalinks,
  keyboard shortcuts, human rrweb import, review suites.
- Extension points: auth adapters (`none`, `header`, `oidc`, plugins), a user-supplied JSON Schema for context
  fields, source-link providers (GitHub, GitLab, URL, templates), storage drivers (filesystem, S3-compatible),
  runtime theming and branding, configurable base path and retention.
- Privacy defaults on: `maskAllInputs`, header / cookie / URL-credential / query redaction, no request or
  response bodies.
- Dockerfile and `docker-compose.yml` (built locally, nothing published), GitHub Actions CI, manual release and
  Pages workflows, static landing page in `site/`.
