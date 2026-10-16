import { describe, expect, it } from 'vitest';

import { hueOf, initialsOf } from '../src/client/comments/Avatar.tsx';
import { commentsEnabled, setCommentsEnabledForTests } from '../src/client/comments/enabled.ts';
import { commentPermalink, parsePermalink } from '../src/client/permalink.ts';
import { SHORTCUT_GROUPS, shortcutFor, shortcutLabel } from '../src/client/shortcuts.ts';

const key = (value: string, modifiers: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  key: value,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...modifiers,
});

describe('comment permalinks', () => {
  it('reads #comment-<id> with its ?t=, alone or together', () => {
    expect(parsePermalink('?t=12.5', '#comment-c-ab12cd34ef', 5)).toEqual({ time: 12_500, comment: 'c-ab12cd34ef' });
    expect(parsePermalink('', '#comment-c-ab12cd34ef', 5)).toEqual({ comment: 'c-ab12cd34ef' });
    expect(parsePermalink('?t=3', '', 5)).toEqual({ time: 3000 });
    expect(parsePermalink('', '#comment-<script>', 5)).toEqual({});
    expect(parsePermalink('', '#comment-x', 5)).toEqual({});
  });

  it('builds the link from the current URL: sets t, names the comment, keeps other parameters', () => {
    const href = 'https://replays.example.com/r/demo?original=1&t=1.0#step-3';
    expect(commentPermalink(href, 'c-ab12cd34ef', 4200)).toBe('https://replays.example.com/r/demo?original=1&t=4.2#comment-c-ab12cd34ef');
    expect(commentPermalink(href, 'c-ab12cd34ef', undefined)).toBe('https://replays.example.com/r/demo?original=1#comment-c-ab12cd34ef');
    const round = commentPermalink('https://x.test/r/a', 'c-zz99yy88xx', 600);
    const url = new URL(round);
    expect(parsePermalink(url.search, url.hash, 0)).toEqual({ time: 600, comment: 'c-zz99yy88xx' });
  });
});

describe('the comment shortcut', () => {
  it('is M, because C and Shift C already open Console and the captions', () => {
    expect(shortcutFor(key('m'))).toBe('add-comment');
    expect(shortcutFor(key('M', { shiftKey: true }))).toBe('add-comment');
    expect(shortcutFor(key('c'))).toBe('console-tab');
    expect(shortcutFor(key('C', { shiftKey: true }))).toBe('switch-captions');
    expect(shortcutLabel('add-comment')).toBe('M');
  });

  it('stays out of the way while typing, and of browser shortcuts', () => {
    expect(shortcutFor(key('m'), { tagName: 'TEXTAREA' })).toBeUndefined();
    expect(shortcutFor(key('m', { metaKey: true }))).toBeUndefined();
    expect(shortcutFor(key('m', { ctrlKey: true }))).toBeUndefined();
  });

  it('is in the help sheet, only where comments are on, and no other shortcut uses M', () => {
    const items = SHORTCUT_GROUPS.flatMap((group) => group.items);
    expect(items.filter((item) => item.keys.includes('M'))).toEqual([
      { keys: ['M'], label: 'Comment at the current time', feature: 'comments' },
    ]);
    // Keys documented in the sheet each map to an action (M is one of them).
    expect(items.flatMap((item) => item.keys).filter((value) => value === 'M')).toHaveLength(1);
  });
});

describe('comments flag in the client', () => {
  it('is off without a document and follows the override', () => {
    setCommentsEnabledForTests(undefined);
    expect(commentsEnabled()).toBe(false);
    setCommentsEnabledForTests(true);
    expect(commentsEnabled()).toBe(true);
    setCommentsEnabledForTests(undefined);
  });
});

describe('avatars', () => {
  it('uses up to two initials, "?" for none, and a stable hue per name', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('ada')).toBe('AD');
    expect(initialsOf('grace.brewster.hopper')).toBe('GH');
    expect(initialsOf('')).toBe('?');
    expect(hueOf('Ada')).toBe(hueOf('Ada'));
    expect(hueOf('Ada')).toBeGreaterThanOrEqual(0);
    expect(hueOf('Ada')).toBeLessThan(360);
  });
});
