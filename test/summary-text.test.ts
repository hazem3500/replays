import { describe, expect, it } from 'vitest';

import { summaryBlocks } from '../src/client/viewer/SummaryText.tsx';

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
});
