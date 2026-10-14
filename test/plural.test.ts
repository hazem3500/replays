import { describe, expect, it } from 'vitest';

import { countLabel } from '../src/client/components/count.tsx';
import { nounFor, plural } from '../src/client/plural.ts';

describe('plural', () => {
  it('spells counts in the right number', () => {
    expect(plural(1, 'error')).toBe('1 error');
    expect(plural(2, 'error')).toBe('2 errors');
    expect(plural(0, 'step')).toBe('0 steps');
    expect(plural(1, 'entry', 'entries')).toBe('1 entry');
    expect(plural(3, 'entry', 'entries')).toBe('3 entries');
    expect(nounFor(1, 'run')).toBe('run');
    expect(nounFor(5, 'run')).toBe('runs');
  });

  it('tab count labels agree with their total', () => {
    expect(countLabel(1, 1, 'request')).toBe(', 1 of 1 request reached');
    expect(countLabel(2, 5, 'request')).toBe(', 2 of 5 requests reached');
    expect(countLabel(0, 1, 'entry', 'entries')).toBe(', 0 of 1 entry reached');
    expect(countLabel(0, 0, 'signal')).toBe('');
  });
});
