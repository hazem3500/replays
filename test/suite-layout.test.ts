import { describe, expect, it } from 'vitest';

import { meetingHref } from '../src/client/comparison/meeting/meeting-href.ts';
import { withLayout } from '../src/client/comparison/meeting/view-state.ts';
import { parseSuiteView, pinRun, settleSuiteView, suiteViewHref } from '../src/client/suite/suite-layout.ts';

const runs = ['run-a', 'run-b', 'run-c'];

describe('suite layout URL', () => {
  it('opens Single without a layout, for unknown or retired names, and ignores stray meeting values', () => {
    expect(parseSuiteView('?pin=run-a&t=3')).toEqual({ layout: 'single', meeting: {} });
    expect(parseSuiteView('?layout=theatre')).toEqual({ layout: 'single', meeting: {} });
    expect(parseSuiteView('?layout=gallery')).toEqual({ layout: 'single', meeting: {} });
  });

  it('reads a pinned grid link as the spotlight', () => {
    expect(parseSuiteView('?layout=grid&pin=run-b&t=4.5')).toEqual({ layout: 'spotlight', meeting: { pin: 'run-b', t: 4.5 } });
  });

  it('round-trips the arrangement and keeps query values it does not own', () => {
    const view = parseSuiteView('?layout=spotlight&pin=run-b&hide=run-c&mute=run-a&align=run-a:500');
    const href = suiteViewHref('/s/nightly/r/run-b', view, '?original=1&layout=grid&t=9');
    expect(href).toBe('/s/nightly/r/run-b?original=1&layout=spotlight&pin=run-b&align=run-a:500&hide=run-c&mute=run-a');
    expect(parseSuiteView(href.slice(href.indexOf('?')))).toEqual(view);
  });

  it('drops the arrangement in Single and carries the run’s time to the viewer', () => {
    const href = suiteViewHref('/s/nightly/r/run-b', { layout: 'single', meeting: { pin: 'run-b' } }, '?layout=spotlight&pin=run-b', 2345);
    expect(href).toBe('/s/nightly/r/run-b?t=2.3');
  });

  it('links a suite chosen on its own to its workspace grid, not /compare', () => {
    expect(meetingHref({ suite: 'nightly' })).toBe('/s/nightly?layout=grid');
    expect(meetingHref({ ids: ['run-a', 'run-b'] })).toBe('/compare?ids=run-a,run-b&before=run-a&after=run-b');
  });
});

describe('suite layout state', () => {
  it('stays in Single while fewer than two runs have recordings', () => {
    expect(settleSuiteView({ layout: 'grid', meeting: {} }, ['run-a'])).toEqual({ layout: 'single', meeting: {} });
  });

  it('pins the selected run when a spotlight link names none', () => {
    expect(settleSuiteView({ layout: 'spotlight', meeting: {} }, runs, 'run-c')).toEqual({
      layout: 'spotlight',
      meeting: { pin: 'run-c' },
    });
  });

  it('keeps a reordered tile list only of the suite’s own runs', () => {
    const settled = settleSuiteView({ layout: 'grid', meeting: { ids: ['run-c', 'other', 'run-a'] } }, runs);
    expect(settled.meeting.ids).toEqual(['run-c', 'run-a']);
    expect(settleSuiteView({ layout: 'grid', meeting: { ids: ['other', 'run-a'] } }, runs).meeting.ids).toBeUndefined();
  });

  it('switches grid and spotlight by pinning and unpinning, skipping hidden runs', () => {
    expect(withLayout({ hide: ['run-a'] }, 'spotlight', runs, 'run-a')).toEqual({ hide: ['run-a'], pin: 'run-b' });
    expect(withLayout({ pin: 'run-b', mute: ['run-c'] }, 'grid', runs)).toEqual({ mute: ['run-c'] });
  });

  it('shows a hidden run when it is pinned from the sidebar', () => {
    expect(pinRun({ hide: ['run-b', 'run-c'] }, 'run-b')).toEqual({ pin: 'run-b', hide: ['run-c'] });
  });
});
