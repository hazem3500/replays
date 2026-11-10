import { describe, expect, it } from 'vitest';

import { BUILT_IN_PROFILES } from '../src/shared/profiles.ts';
import { isPerformanceFocused } from '../src/shared/performance-focus.ts';

describe('performance-focused replays', () => {
  it('is false with nothing performance-related', () => {
    expect(isPerformanceFocused({})).toBe(false);
    expect(isPerformanceFocused({ view: 'standard', profiles: [undefined, { view: 'debug' }], tags: ['smoke'] })).toBe(false);
    expect(isPerformanceFocused({ profiles: [{ capture: { performance: false } }] })).toBe(false);
  });

  it('follows the Performance view, however the page reached it', () => {
    expect(isPerformanceFocused({ view: 'performance' })).toBe(true);
  });

  it('follows a profile that opens in the Performance view or captures performance', () => {
    expect(isPerformanceFocused({ profiles: [{ view: 'performance' }] })).toBe(true);
    expect(isPerformanceFocused({ profiles: [undefined, { capture: { performance: true } }] })).toBe(true);
    expect(isPerformanceFocused({ profiles: BUILT_IN_PROFILES.filter((profile) => profile.id === 'performance') })).toBe(true);
  });

  it('follows a performance tag', () => {
    expect(isPerformanceFocused({ tags: ['checkout', 'performance'] })).toBe(true);
  });
});
