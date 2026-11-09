import { describe, expect, it } from 'vitest';

import { FOR_YOU, landingTab, parseTabChoice, tabChoiceKey } from '../src/client/index/for-you.ts';
import { isPersonMe, personMatch } from '../src/shared/people.ts';

describe('For you landing', () => {
  it('tries For you for a matchable viewer with no stored choice', () => {
    expect(landingTab({ explicit: false, canMatch: true, stored: undefined })).toEqual({ forYou: true, probe: true });
  });

  it('lets a stored choice win without probing', () => {
    expect(landingTab({ explicit: false, canMatch: true, stored: FOR_YOU })).toEqual({ forYou: true, probe: false });
    expect(landingTab({ explicit: false, canMatch: true, stored: 'all' })).toEqual({ forYou: false, probe: false });
  });

  it('stays on All for a link with its own view or an unmatchable viewer', () => {
    expect(landingTab({ explicit: true, canMatch: true, stored: FOR_YOU })).toEqual({ forYou: false, probe: false });
    expect(landingTab({ explicit: false, canMatch: false, stored: undefined })).toEqual({ forYou: false, probe: false });
  });

  it('keeps one choice per viewer and ignores unknown stored values', () => {
    expect(tabChoiceKey('a')).not.toBe(tabChoiceKey('b'));
    expect(parseTabChoice('for-you')).toBe('for-you');
    expect(parseTabChoice('all')).toBe('all');
    expect(parseTabChoice('x')).toBeUndefined();
    expect(parseTabChoice(null)).toBeUndefined();
  });
});

describe('who counts as you', () => {
  const author = { role: 'pr-author', handles: { github: 'TobiasPrt' } };
  const people = [author, { role: 'reviewer', email: 'Ada@Example.com' }];

  it('matches by email in any role, ignoring case', () => {
    expect(personMatch(people, { email: 'ada@example.com' })).toBe('reviewer');
  });

  it('matches by a linked handle, ignoring case', () => {
    expect(isPersonMe(author, { handles: { github: 'tobiasprt' } })).toBe(true);
    expect(personMatch(people, { handles: { github: 'tobiasprt' } })).toBe('pr-author');
  });

  it('does not match someone else or an empty identity', () => {
    expect(personMatch(people, { email: 'bob@example.com', handles: { github: 'bob' } })).toBeUndefined();
    expect(personMatch(people, {})).toBeUndefined();
  });
});
