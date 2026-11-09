import { describe, expect, it } from 'vitest';

import { displayTitle, sourceShortLabel } from '../src/client/display-title.ts';

const pr = { provider: 'github', label: 'toggl/toggl_focus_fe#7893' };

describe('displayTitle', () => {
  it('drops the kind, the matching repo#PR and the commit prefix', () => {
    const title = 'Design review · toggl/toggl_focus_fe#7893 · feat(timer): add sidebar timer card behind timer_sidebar_card';
    expect(displayTitle({ title, sources: [pr] })).toBe('Add sidebar timer card behind timer_sidebar_card');
  });

  it('handles a walkthrough with a bare fix prefix', () => {
    expect(displayTitle({ title: 'Walkthrough · toggl/toggl_focus_fe#7893 · fix: stop the timer', sources: [pr] })).toBe('Stop the timer');
  });

  it('keeps titles without a known prefix', () => {
    expect(displayTitle({ title: 'Checkout flow', sources: [pr] })).toBe('Checkout flow');
    expect(displayTitle({ title: 'Toki end-to-end upload check (safe to ignore)' })).toBe('Toki end-to-end upload check (safe to ignore)');
  });

  it('keeps titles whose repo is not a source', () => {
    const title = 'Design review · toggl/other#1 · feat: x';
    expect(displayTitle({ title, sources: [pr] })).toBe(title);
  });
});

describe('sourceShortLabel', () => {
  it('uses the repo name without owner or toggl_ prefix', () => {
    expect(sourceShortLabel(pr)).toBe('focus_fe#7893');
    expect(sourceShortLabel({ provider: 'github', label: 'acme/api#12' })).toBe('api#12');
  });

  it('ignores other providers and labels', () => {
    expect(sourceShortLabel({ provider: 'linear', label: 'ENG-1' })).toBeUndefined();
    expect(sourceShortLabel({ provider: 'github', label: '' })).toBeUndefined();
  });
});
