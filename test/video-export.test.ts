import { describe, expect, it } from 'vitest';

import {
  describeRenderResponse,
  type ExportEvent,
  exportReducer,
  type ExportState,
  formatBytes,
  IDLE,
  isActive,
  progressAnnouncement,
  progressLabel,
  exportLabel,
  renderVariantUrl,
  videoFilename,
} from '../src/client/video-export.ts';

const run = (...events: ExportEvent[]) => events.reduce<ExportState>(exportReducer, IDLE);

describe('export state machine', () => {
  it('walks start → queued → rendering → saved', () => {
    expect(run({ type: 'start' })).toEqual({ kind: 'starting' });
    expect(run({ type: 'start' }, { type: 'job', job: { status: 'queued' } })).toEqual({ kind: 'queued' });
    const rendering = run({ type: 'start' }, { type: 'job', job: { status: 'rendering', progress: 0.4, etaMs: 3000 } });
    expect(rendering).toEqual({ kind: 'rendering', progress: 0.4, etaMs: 3000 });
    expect(exportReducer(rendering, { type: 'job', job: { status: 'done' } })).toEqual({ kind: 'rendering', progress: 1 });
    expect(exportReducer(rendering, { type: 'saved' })).toBe(IDLE);
  });

  it('clamps progress', () => {
    expect(run({ type: 'start' }, { type: 'job', job: { status: 'rendering', progress: 3 } })).toMatchObject({ progress: 1 });
    expect(run({ type: 'start' }, { type: 'job', job: { status: 'rendering' } })).toMatchObject({ progress: 0 });
  });

  it('ignores job updates once idle (a late poll after Cancel)', () => {
    const cancelled = run({ type: 'start' }, { type: 'job', job: { status: 'rendering', progress: 0.2 } }, { type: 'cancel' });
    expect(cancelled).toBe(IDLE);
    expect(exportReducer(cancelled, { type: 'job', job: { status: 'rendering', progress: 0.3 } })).toBe(IDLE);
    expect(exportReducer(cancelled, { type: 'failed', message: 'late' })).toBe(IDLE);
  });

  it('does not restart while active', () => {
    const queued = run({ type: 'start' }, { type: 'job', job: { status: 'queued' } });
    expect(exportReducer(queued, { type: 'start' })).toBe(queued);
  });

  it('turns a failed job or a vanished job into an error that can be retried or dismissed', () => {
    const failed = run({ type: 'start' }, { type: 'job', job: { status: 'failed', error: 'timed out after 900 s' } });
    expect(failed).toEqual({ kind: 'error', message: 'The render failed: timed out after 900 s' });
    expect(exportReducer(failed, { type: 'start' })).toEqual({ kind: 'starting' });
    expect(exportReducer(failed, { type: 'dismiss' })).toBe(IDLE);
    expect(run({ type: 'start' }, { type: 'job', job: { status: 'none' } })).toMatchObject({ kind: 'error' });
  });

  it('reports request failures while active', () => {
    expect(run({ type: 'start' }, { type: 'failed', message: 'offline' })).toEqual({ kind: 'error', message: 'offline' });
    expect(isActive(run({ type: 'start' }))).toBe(true);
    expect(isActive(IDLE)).toBe(false);
  });
});

describe('labels', () => {
  it('shows calm progress text', () => {
    expect(progressLabel({ kind: 'starting' })).toBe('Starting render…');
    expect(progressLabel({ kind: 'queued' })).toBe('Waiting for another render…');
    expect(progressLabel({ kind: 'rendering', progress: 0.409 })).toBe('Rendering video… 40%');
    // The live region names the phase only, so polling does not announce every percent.
    expect(progressAnnouncement({ kind: 'rendering', progress: 0.409 })).toBe('Rendering video…');
    expect(progressAnnouncement({ kind: 'rendering', progress: 0.9 })).toBe('Rendering video…');
    expect(progressAnnouncement({ kind: 'queued' })).toBe('Waiting for another render…');
    expect(progressLabel(IDLE)).toBe('');
  });

  it('explains API failures', () => {
    expect(describeRenderResponse(503, { error: 'render unavailable' })).toMatch(/not available/);
    expect(describeRenderResponse(429, undefined)).toMatch(/Too many/);
    expect(describeRenderResponse(404, undefined)).toMatch(/no longer exists/);
    expect(describeRenderResponse(422, { error: 'replays longer than 10 min are not rendered' })).toBe(
      'Replays longer than 10 min are not rendered.',
    );
    expect(describeRenderResponse(500, undefined)).toBe('The render request failed (500).');
  });

  it('names files after the replay and formats sizes', () => {
    expect(videoFilename('tracker-with-video')).toBe('tracker-with-video.mp4');
    expect(videoFilename('tracker-with-video', { captions: true })).toBe('tracker-with-video-captions.mp4');
    expect(videoFilename('t', { speed: 2, captions: true })).toBe('t-2x-captions.mp4');
    expect(videoFilename('t', { speed: 0.5, skipInactive: false, captions: true })).toBe('t-0.5x-full-captions.mp4');
    expect(videoFilename('t', { speed: 2, skipInactive: true })).toBe('t-2x.mp4');
    expect(videoFilename('t', { speed: 1, skipInactive: true, captions: false })).toBe('t.mp4');
    expect(formatBytes(257_746)).toBe('252 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('render variants', () => {
  it('selects a variant by query, defaults left out so the plain URLs stay as they were', () => {
    const url = '/api/replays/a/render';
    expect(renderVariantUrl(url, {})).toBe(url);
    expect(renderVariantUrl(url, { speed: 1, skipInactive: true, captions: false }, true)).toBe(`${url}/file`);
    expect(renderVariantUrl(url, { captions: true })).toBe(`${url}?captions=1`);
    expect(renderVariantUrl(url, { speed: 2, skipInactive: false, captions: true }, true)).toBe(
      `${url}/file?speed=2&skipInactive=0&captions=1`,
    );
  });

  it('summarises non-default options in the export label', () => {
    expect(exportLabel('Export video', { speed: 1, skipInactive: true, captions: false })).toBe('Export video');
    expect(exportLabel('Export video', { speed: 2, skipInactive: false, captions: true })).toBe(
      'Export video · 2× · captions · full idle time',
    );
    expect(exportLabel('Download video', { speed: 0.5 })).toBe('Download video · 0.5×');
  });
});
