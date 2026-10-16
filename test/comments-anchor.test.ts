import { describe, expect, it } from 'vitest';

import {
  activeThread,
  ANONYMOUS_NAME,
  cleanBody,
  displayName,
  MAX_COMMENT_BODY,
  type PublicComment,
  placeComment,
  publicComment,
  sourceTimeAt,
  type StoredComment,
  threadsOf,
} from '../src/shared/comments.ts';
import { editTimeline, type ReplayEdits } from '../src/shared/edits.ts';

const edits = (partial: Partial<ReplayEdits>): ReplayEdits => ({ version: 1, cuts: [], ...partial });

describe('comment anchoring: source time → the timeline on screen', () => {
  it('is the source time itself when nothing is edited, and "general" without a time', () => {
    expect(placeComment(4200)).toEqual({ state: 'visible', at: 4200 });
    expect(placeComment(4200, editTimeline(undefined, 10_000))).toEqual({ state: 'visible', at: 4200 });
    expect(placeComment(undefined, editTimeline(edits({ trim: { start: 1000, end: 5000 } }), 10_000))).toEqual({ state: 'general' });
  });

  it('shifts markers left by a trimmed start and hides what the trim cut off at either end', () => {
    const timeline = editTimeline(edits({ trim: { start: 2000, end: 8000 } }), 10_000);
    expect(placeComment(2000, timeline)).toEqual({ state: 'visible', at: 0 });
    expect(placeComment(5000, timeline)).toEqual({ state: 'visible', at: 3000 });
    expect(placeComment(1999, timeline)).toEqual({ state: 'removed' });
    expect(placeComment(0, timeline)).toEqual({ state: 'removed' });
    expect(placeComment(7999, timeline)).toEqual({ state: 'visible', at: 5999 });
    // The trim end itself is gone (the kept range is [start, end)).
    expect(placeComment(8000, timeline)).toEqual({ state: 'removed' });
    expect(placeComment(9500, timeline)).toEqual({ state: 'removed' });
  });

  it('collapses a cut: comments after it move earlier by its length, comments inside it are "removed"', () => {
    const timeline = editTimeline(edits({ cuts: [{ id: 'c1', from: 3000, to: 5000 }] }), 10_000);
    expect(placeComment(2999, timeline)).toEqual({ state: 'visible', at: 2999 });
    expect(placeComment(3000, timeline)).toEqual({ state: 'removed' });
    expect(placeComment(4999, timeline)).toEqual({ state: 'removed' });
    expect(placeComment(5000, timeline)).toEqual({ state: 'visible', at: 3000 });
    expect(placeComment(9000, timeline)).toEqual({ state: 'visible', at: 7000 });
  });

  it('compresses a speed-up: its comments land proportionally, later ones move earlier', () => {
    // 2000–6000 played at 4×: those 4 s take 1 s.
    const timeline = editTimeline(edits({ speeds: [{ id: 's1', from: 2000, to: 6000, rate: 4 }] }), 10_000);
    expect(placeComment(1000, timeline)).toEqual({ state: 'visible', at: 1000 });
    expect(placeComment(2000, timeline)).toEqual({ state: 'visible', at: 2000 });
    expect(placeComment(4000, timeline)).toEqual({ state: 'visible', at: 2500 });
    expect(placeComment(6000, timeline)).toEqual({ state: 'visible', at: 3000 });
    expect(placeComment(8000, timeline)).toEqual({ state: 'visible', at: 5000 });
  });

  it('combines a trim, a cut and a speed-up', () => {
    const timeline = editTimeline(
      edits({
        trim: { start: 1000, end: 9000 },
        cuts: [{ id: 'c1', from: 3000, to: 4000 }],
        speeds: [{ id: 's1', from: 5000, to: 7000, rate: 2 }],
      }),
      10_000,
    );
    expect(placeComment(500, timeline).state).toBe('removed');
    expect(placeComment(1000, timeline)).toEqual({ state: 'visible', at: 0 });
    expect(placeComment(3500, timeline).state).toBe('removed');
    expect(placeComment(4000, timeline)).toEqual({ state: 'visible', at: 2000 });
    expect(placeComment(6000, timeline)).toEqual({ state: 'visible', at: 3500 });
    expect(placeComment(8000, timeline)).toEqual({ state: 'visible', at: 5000 });
    expect(placeComment(9500, timeline).state).toBe('removed');
  });

  it('maps the playhead back to source time when a comment is created on the edited timeline', () => {
    expect(sourceTimeAt(1234.4)).toBe(1234);
    const timeline = editTimeline(
      edits({
        trim: { start: 1000, end: 9000 },
        cuts: [{ id: 'c1', from: 3000, to: 4000 }],
        speeds: [{ id: 's1', from: 5000, to: 7000, rate: 2 }],
      }),
      10_000,
    );
    expect(sourceTimeAt(0, timeline)).toBe(1000);
    expect(sourceTimeAt(1500, timeline)).toBe(2500);
    expect(sourceTimeAt(2000, timeline)).toBe(4000);
    expect(sourceTimeAt(3500, timeline)).toBe(6000);
    // Round trip: what was created at an edited time shows at that edited time again.
    for (const watched of [0, 800, 1999, 2000, 2750, 3500, 4400, 5000]) {
      const source = sourceTimeAt(watched, timeline);
      const placed = placeComment(source, timeline);
      expect(placed.state).toBe('visible');
      expect(Math.abs((placed as { at: number }).at - watched)).toBeLessThanOrEqual(1);
    }
  });
});

const comment = (id: string, extra: Partial<PublicComment> = {}): PublicComment => ({
  id,
  body: id,
  author: { name: 'Ada' },
  createdAt: '2026-10-14T10:00:00.000Z',
  mine: false,
  ...extra,
});

describe('threads and the playhead', () => {
  it('lists whole-replay comments first, then pinned ones by source time, replies under their root', () => {
    const threads = threadsOf([
      comment('c-late', { at: 9000 }),
      comment('c-early', { at: 1000, createdAt: '2026-10-14T10:05:00.000Z' }),
      comment('c-reply2', { parentId: 'c-early', createdAt: '2026-10-14T10:07:00.000Z' }),
      comment('c-whole'),
      comment('c-reply1', { parentId: 'c-early', createdAt: '2026-10-14T10:06:00.000Z' }),
      comment('c-orphan', { parentId: 'c-gone' }),
    ]);
    expect(threads.map((thread) => thread.root.id)).toEqual(['c-whole', 'c-early', 'c-late']);
    expect(threads[1]!.replies.map((reply) => reply.id)).toEqual(['c-reply1', 'c-reply2']);
  });

  it('highlights the latest pinned thread at or before the playhead, else the nearest one ahead', () => {
    const pins = [
      { id: 'a', at: 1000 },
      { id: 'b', at: 4000 },
      { id: 'c', at: 8000 },
    ];
    expect(activeThread(pins, 0)).toBe('a');
    expect(activeThread(pins, 999)).toBe('a');
    expect(activeThread(pins, 1000)).toBe('a');
    expect(activeThread(pins, 4500)).toBe('b');
    expect(activeThread(pins, 9999)).toBe('c');
    expect(activeThread([], 5)).toBeUndefined();
  });
});

describe('comment text and authors', () => {
  it('trims, normalizes and strips control and bidi-override characters', () => {
    expect(cleanBody('  hello\r\nworld\u0000\u0007 ')).toBe('hello\nworld');
    expect(cleanBody('a‮b⁦c')).toBe('abc');
    expect(cleanBody('one\n\n\n\n\n\ntwo')).toBe('one\n\n\ntwo');
    expect(cleanBody('é')).toBe('é');
  });

  it('refuses empty, non-text and over-long bodies', () => {
    expect(() => cleanBody('   ')).toThrow('write something');
    expect(() => cleanBody(42)).toThrow('text');
    expect(cleanBody('x'.repeat(MAX_COMMENT_BODY))).toHaveLength(MAX_COMMENT_BODY);
    expect(() => cleanBody('x'.repeat(MAX_COMMENT_BODY + 1))).toThrow(String(MAX_COMMENT_BODY));
  });

  it("serves authors without their id, marks the caller's own, and labels anonymous ones", () => {
    const stored: StoredComment = {
      id: 'c-abc12345',
      body: 'hi',
      author: { id: 'ada@example.com', name: 'Ada Lovelace', avatarUrl: 'https://example.com/a.png' },
      createdAt: '2026-10-14T10:00:00.000Z',
    };
    const mine = publicComment(stored, 'ada@example.com');
    expect(mine.mine).toBe(true);
    expect(JSON.stringify(mine)).not.toContain('ada@example.com');
    expect(publicComment(stored, 'bob@example.com').mine).toBe(false);
    expect(displayName({ id: 'ada@example.com' })).toBe('ada');
    expect(displayName({ id: 'anonymous', anonymous: true })).toBe(ANONYMOUS_NAME);
    expect(publicComment({ ...stored, author: { id: 'anonymous', anonymous: true } }, 'x').author).toEqual({
      name: ANONYMOUS_NAME,
      anonymous: true,
    });
  });
});
