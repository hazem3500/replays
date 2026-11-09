import { describe, expect, it } from 'vitest';

import { isTypingTarget, shortcutFor } from '../src/client/shortcuts.ts';
import { activeStepIndex, nextStepIndex, previousStepIndex } from '../src/client/timeline.ts';

const key = (value: string, modifiers: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  key: value,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...modifiers,
});

describe('shortcutFor', () => {
  it('maps the documented keys', () => {
    expect(shortcutFor(key(' '))).toBe('play-pause');
    expect(shortcutFor(key('k'))).toBe('play-pause');
    expect(shortcutFor(key('ArrowLeft'))).toBe('seek-back');
    expect(shortcutFor(key('ArrowRight', { shiftKey: true }))).toBe('seek-forward-long');
    expect(shortcutFor(key('['))).toBe('previous-step');
    expect(shortcutFor(key(']'))).toBe('next-step');
    expect(shortcutFor(key('e'))).toBe('next-error');
    expect(shortcutFor(key('E', { shiftKey: true }))).toBe('previous-error');
    expect(shortcutFor(key('4'))).toBeUndefined();
    expect(shortcutFor(key('>', { shiftKey: true }))).toBe('speed-up');
    expect(shortcutFor(key('<', { shiftKey: true }))).toBe('speed-down');
    expect(shortcutFor({ ...key(')', { shiftKey: true }), code: 'Digit0' })).toBe('speed-reset');
    expect(shortcutFor({ ...key('=', { shiftKey: true }), code: 'Digit0' })).toBe('speed-reset');
    expect(shortcutFor(key('c'))).toBe('console-tab');
    expect(shortcutFor(key('n'))).toBe('network-tab');
    expect(shortcutFor(key('p'))).toBe('performance-tab');
    expect(shortcutFor(key('f'))).toBe('fullscreen');
    expect(shortcutFor(key('?', { shiftKey: true }))).toBe('shortcuts');
    expect(shortcutFor(key('x'))).toBeUndefined();
  });

  it('leaves browser and OS shortcuts alone', () => {
    expect(shortcutFor(key('c', { metaKey: true }))).toBeUndefined();
    expect(shortcutFor(key('f', { ctrlKey: true }))).toBeUndefined();
    expect(shortcutFor(key('ArrowLeft', { altKey: true }))).toBeUndefined();
  });

  it('is ignored while typing and lets buttons under the keyboard handle Space', () => {
    expect(shortcutFor(key('k'), { tagName: 'INPUT', type: 'search' })).toBeUndefined();
    expect(shortcutFor(key('k'), { tagName: 'TEXTAREA' })).toBeUndefined();
    expect(shortcutFor(key('k'), { tagName: 'DIV', isContentEditable: true })).toBeUndefined();
    expect(shortcutFor(key(' '), { tagName: 'BUTTON' })).toBeUndefined();
    expect(shortcutFor(key('k'), { tagName: 'BUTTON' })).toBe('play-pause');
    // The scrubber is a range input: arrows still seek by a second there.
    expect(shortcutFor(key('ArrowRight'), { tagName: 'INPUT', type: 'range' })).toBe('seek-forward');
  });

  it('classifies typing targets', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('step navigation', () => {
  const steps = [{ at: 0 }, { at: 771 }, { at: 1685 }, { at: 2920 }];
  it('finds the next and previous step around the playhead', () => {
    expect(nextStepIndex(steps, 0)).toBe(1);
    expect(nextStepIndex(steps, 1685)).toBe(3);
    expect(nextStepIndex(steps, 3000)).toBe(-1);
    expect(previousStepIndex(steps, 2000)).toBe(2);
    expect(previousStepIndex(steps, 1685)).toBe(1);
    expect(previousStepIndex(steps, 0)).toBe(-1);
  });

  it('reaches steps logged a few milliseconds apart once the viewer knows the current step', () => {
    // suite-run-timer: "Describe the entry" at 5396, "Start the timer" 17 ms later.
    const close = [{ at: 4482 }, { at: 5396 }, { at: 5413 }, { at: 5555 }];
    expect(nextStepIndex(close, 5396, 1)).toBe(2);
    expect(nextStepIndex(close, 5413, 2)).toBe(3);
    expect(nextStepIndex(close, 5555, 3)).toBe(-1);
    expect(previousStepIndex(close, 5413, 2)).toBe(1);
    expect(previousStepIndex(close, 4482, 0)).toBe(-1);
    // Without a known step (after a scrub), the next step is the first one after the playhead.
    expect(nextStepIndex(close, 5400)).toBe(2);
  });

  it('counts a step logged after the last DOM event as reached at the end', () => {
    const trailing = [{ at: 0 }, { at: 11876 }, { at: 12888 }];
    expect(activeStepIndex(trailing, 12885)).toBe(1);
    expect(activeStepIndex(trailing, 12885, 12885)).toBe(2);
    expect(activeStepIndex(trailing, 12000, 12885)).toBe(1);
    expect(activeStepIndex([], 0, 10)).toBe(-1);
  });
});

const press = (value: string, shiftKey = false) => ({ key: value, shiftKey, ctrlKey: false, metaKey: false, altKey: false });

describe('suite run shortcuts', () => {
  it('J moves to the next run and Shift+J to the previous one, leaving K as play/pause', () => {
    expect(shortcutFor(press('j'))).toBe('next-run');
    expect(shortcutFor(press('J', true))).toBe('previous-run');
    expect(shortcutFor(press('k'))).toBe('play-pause');
  });
});

describe('folded steps', () => {
  const steps = [{ at: 0 }, { at: 100 }, { at: 100, folded: true as const }, { at: 200 }];

  it('are skipped by the active, next and previous step', () => {
    expect(activeStepIndex(steps, 150)).toBe(1);
    expect(nextStepIndex(steps, 50)).toBe(1);
    expect(nextStepIndex(steps, 100, 1)).toBe(3);
    expect(previousStepIndex(steps, 300, 3)).toBe(1);
  });
});
