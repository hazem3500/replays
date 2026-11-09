import { describe, expect, it } from 'vitest';

import { capAtWord as recorderCap, STEP_LABEL_MAX as recorderMax, tidyStepName as recorderTidy } from '../src/recorder/step-label.ts';
import { capAtWord, STEP_LABEL_MAX, tidyStepName } from '../src/shared/step-label.ts';

const CASES = [
  '',
  'Save',
  'asdadasd, 10:00 AM–1:15 PM, 3h 15m asdadasd asdasd and then some more text',
  'Review the quarterly budget forecast for the whole platform team before Friday',
  `${'x'.repeat(80)} tail`,
  'Line one\nLine two that goes on',
  'Cut here: …',
  'Already short...',
  `${'😀'.repeat(60)}`,
  '   padded   words   ',
];

describe('capAtWord', () => {
  it('leaves a name within the cap as it is', () => {
    expect(capAtWord('Save draft')).toBe('Save draft');
  });

  it('cuts at the last word boundary within the cap', () => {
    expect(capAtWord('one two three four', 12)).toBe('one two');
  });

  it('keeps the result within the cap and adds no ellipsis', () => {
    const label = capAtWord('Review the quarterly budget forecast for the whole platform team before Friday');
    expect(label.length).toBeLessThanOrEqual(STEP_LABEL_MAX);
    expect(label).toBe('Review the quarterly budget forecast for the');
    expect(label).not.toMatch(/…|\.\.\./);
  });

  it('drops an ellipsis already at the end, and separators left by the cut', () => {
    expect(capAtWord('Next month…')).toBe('Next month');
    expect(capAtWord('Pending...')).toBe('Pending');
    expect(capAtWord('alpha, beta, gamma', 12)).toBe('alpha, beta');
  });

  it('cuts one very long word at the cap without splitting a character', () => {
    expect(capAtWord('x'.repeat(80))).toHaveLength(STEP_LABEL_MAX);
    expect(capAtWord('😀'.repeat(60), 9)).toBe('😀😀😀😀');
  });

  it('flattens line breaks into one line', () => {
    expect(capAtWord('Line one\nLine two')).toBe('Line one Line two');
  });
});

describe('tidyStepName', () => {
  it.each([
    ['Profile:', 'Profile'],
    ['  Plan   time  –', 'Plan time'],
    ['Tasks, ', 'Tasks'],
    ['Plan time • 4h', 'Plan time • 4h'],
  ])('tidies %j to %j', (text, expected) => {
    expect(tidyStepName(text)).toBe(expected);
    expect(recorderTidy(text)).toBe(expected);
  });
});

describe('the recorder copy of the label rules', () => {
  it('uses the same cap', () => {
    expect(recorderMax).toBe(STEP_LABEL_MAX);
  });

  it.each(CASES.map((text) => [text.slice(0, 30), text] as const))('shortens %j as the shared rule does', (_name, text) => {
    for (const max of [STEP_LABEL_MAX, 9, 200]) expect(recorderCap(text, max)).toBe(capAtWord(text, max));
  });
});
