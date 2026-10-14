# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project aims to follow [Semantic Versioning](https://semver.org/) once it reaches 1.0.

## [0.1.0] - Unreleased

First public-shaped version, extracted and generalised from an internal debugging tool.

### Added

- Capture CLI (`replay-kit capture`): records a page with scripted steps into one `replay.json` (rrweb events,
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
