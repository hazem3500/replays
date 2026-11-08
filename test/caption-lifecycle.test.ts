import { expect, it } from 'vitest';
import { captionAt } from '../src/client/step-caption.ts';

it.each(['Recording started', 'Recording stopped', 'Recording stopped (user)', 'Recording stopped (max-size)'])(
  'suppresses legacy generated lifecycle caption %s',
  (label) => {
    expect(captionAt([{ at: 0, label }], 100, 1000)).toBeUndefined();
  },
);

it('keeps an authored action even when its label resembles a lifecycle marker', () => {
  expect(captionAt([{ at: 0, label: 'Recording started', kind: 'action' }], 100, 1000)?.label).toBe('Recording started');
});

it('does not replace the captured page notification with a lifecycle suppression rule', () => {
  expect(captionAt([{ at: 0, label: 'Saved changes', kind: 'click' }], 100, 1000)?.label).toBe('Saved changes');
});
