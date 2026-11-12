import { describe, expect, it } from 'vitest';

import { leadLabel, summaryBlocks } from '../src/client/viewer/SummaryText.tsx';

describe('summaryBlocks', () => {
  it('splits paragraphs on blank lines and groups bullet lines into lists', () => {
    expect(summaryBlocks('Good enough: yes.\nSecond line.\n\n- one\n- two\n* three\n\nTail')).toEqual([
      { kind: 'p', text: 'Good enough: yes. Second line.' },
      { kind: 'ul', items: ['one', 'two', 'three'] },
      { kind: 'p', text: 'Tail' },
    ]);
  });

  it('keeps markup as text', () => {
    expect(summaryBlocks('<img src=x onerror=alert(1)>')).toEqual([{ kind: 'p', text: '<img src=x onerror=alert(1)>' }]);
  });

  it('finds a short leading label and leaves ordinary sentences alone', () => {
    expect(leadLabel('Checked: the over-fee warning.')).toEqual({ label: 'Checked', rest: 'the over-fee warning.' });
    expect(leadLabel('Good enough: yes')).toEqual({ label: 'Good enough', rest: 'yes' });
    expect(leadLabel('See https://example.com for more')).toBeUndefined();
    expect(leadLabel('this one is lowercase: no')).toBeUndefined();
    expect(leadLabel('A label that is far too long to be a label: no')).toBeUndefined();
  });
});
