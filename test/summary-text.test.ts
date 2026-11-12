import { describe, expect, it } from 'vitest';

import { leadLabel, liftReport, parseInline, parseResult, shortenUrl, summaryBlocks } from '../src/client/viewer/summary-markdown.ts';

describe('summaryBlocks', () => {
  it('splits paragraphs on blank lines and groups bullet lines into lists', () => {
    expect(summaryBlocks('Good enough: yes.\nSecond line.\n\n- one\n- two\n* three\n\nTail')).toEqual([
      { kind: 'p', text: 'Good enough: yes. Second line.' },
      { kind: 'list', ordered: false, items: [{ text: 'one' }, { text: 'two' }, { text: 'three' }] },
      { kind: 'p', text: 'Tail' },
    ]);
  });

  it('keeps markup as text', () => {
    expect(summaryBlocks('<img src=x onerror=alert(1)>')).toEqual([{ kind: 'p', text: '<img src=x onerror=alert(1)>' }]);
  });

  it('starts a new paragraph at each report label so consecutive Toki lines stay apart', () => {
    expect(summaryBlocks('Checked: the fee.\nResult: Fail (mocked)\nObserved: nothing.')).toEqual([
      { kind: 'p', text: 'Checked: the fee.' },
      { kind: 'p', text: 'Result: Fail (mocked)' },
      { kind: 'p', text: 'Observed: nothing.' },
    ]);
  });

  it('reads numbered lists and one level of nesting by indent', () => {
    expect(summaryBlocks('1. first\n2. second\n  - inner a\n  - inner b\n3. third')).toEqual([
      {
        kind: 'list',
        ordered: true,
        items: [
          { text: 'first' },
          { text: 'second', children: { kind: 'list', ordered: false, items: [{ text: 'inner a' }, { text: 'inner b' }] } },
          { text: 'third' },
        ],
      },
    ]);
  });

  it('reads headings, quotes and fenced code, which keeps its lines and blank lines as written', () => {
    expect(summaryBlocks('## Title\n### Sub\n> quoted\n> more\n\n```\nconst a = 1;\n\n- not a list\n```\nafter')).toEqual([
      { kind: 'heading', level: 2, text: 'Title' },
      { kind: 'heading', level: 3, text: 'Sub' },
      { kind: 'quote', text: 'quoted more' },
      { kind: 'code', text: 'const a = 1;\n\n- not a list' },
      { kind: 'p', text: 'after' },
    ]);
  });

  it('keeps an unclosed fence as code to the end', () => {
    expect(summaryBlocks('```\nline')).toEqual([{ kind: 'code', text: 'line' }]);
  });
});

describe('leadLabel', () => {
  it('finds a short leading label and leaves ordinary sentences alone', () => {
    expect(leadLabel('Checked: the over-fee warning.')).toEqual({ label: 'Checked', rest: 'the over-fee warning.' });
    expect(leadLabel('Good enough: yes')).toEqual({ label: 'Good enough', rest: 'yes' });
    expect(leadLabel('See https://example.com for more')).toBeUndefined();
    expect(leadLabel('this one is lowercase: no')).toBeUndefined();
    expect(leadLabel('A label that is far too long to be a label: no')).toBeUndefined();
  });
});

describe('parseInline', () => {
  it('parses code, bold and italic, nesting bold around italic', () => {
    expect(parseInline('a `x*y` **b *c*** _d_')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'code', text: 'x*y' },
      { kind: 'text', text: ' ' },
      {
        kind: 'strong',
        children: [
          { kind: 'text', text: 'b ' },
          { kind: 'em', children: [{ kind: 'text', text: 'c' }] },
        ],
      },
      { kind: 'text', text: ' ' },
      { kind: 'em', children: [{ kind: 'text', text: 'd' }] },
    ]);
  });

  it('leaves unclosed markers and snake_case words as text', () => {
    expect(parseInline('2 * 3 and snake_case_name and **open')).toEqual([{ kind: 'text', text: '2 * 3 and snake_case_name and **open' }]);
  });

  it('links http and https addresses, labelled or bare, without the trailing sentence punctuation', () => {
    expect(parseInline('[docs](https://example.com/a) and see http://example.com/b.')).toEqual([
      { kind: 'link', href: 'https://example.com/a', label: 'docs' },
      { kind: 'text', text: ' and see ' },
      { kind: 'link', href: 'http://example.com/b', label: 'example.com/b' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('never turns a javascript:, data: or other non-http link into a link', () => {
    for (const text of ['[x](javascript:alert(1))', '[x](data:text/html,hi)', '[x](ftp://example.com/f)', '[x](//evil.test)']) {
      expect(parseInline(text).some((node) => node.kind === 'link')).toBe(false);
      expect(
        parseInline(text)
          .map((node) => (node.kind === 'text' ? node.text : ''))
          .join(''),
      ).toBe(text);
    }
  });

  it('keeps a closing parenthesis out of a URL that did not open one', () => {
    expect(parseInline('(see https://example.com/a)')).toEqual([
      { kind: 'text', text: '(see ' },
      { kind: 'link', href: 'https://example.com/a', label: 'example.com/a' },
      { kind: 'text', text: ')' },
    ]);
  });
});

describe('shortenUrl', () => {
  it('names GitHub pull requests, issues and their comments', () => {
    expect(shortenUrl('https://github.com/hazem3500/replays/pull/388')).toBe('hazem3500/replays#388');
    expect(shortenUrl('https://github.com/o/r/issues/7')).toBe('o/r#7');
    expect(shortenUrl('https://github.com/o/r/pull/9#issuecomment-123456')).toBe('Comment on o/r#9');
  });

  it('shows other addresses as host and a trimmed path, without www, query or trailing slash', () => {
    expect(shortenUrl('https://www.example.com/')).toBe('example.com');
    expect(shortenUrl('https://example.com/a/b/?token=secret')).toBe('example.com/a/b');
    expect(shortenUrl(`https://example.com/${'x'.repeat(80)}`)).toHaveLength(44);
  });
});

describe('parseResult', () => {
  it('reads a status with its qualifier', () => {
    expect(parseResult('Result: Fail (mocked responses)')).toEqual({
      status: 'Fail',
      tone: 'fail',
      qualifier: 'mocked responses',
      rest: '',
    });
    expect(parseResult('Result: passed')).toEqual({ status: 'passed', tone: 'pass', rest: '' });
    expect(parseResult('Result: Partial (two of three)')?.tone).toBe('partial');
  });

  it('keeps text after the status as the rest and ignores unknown words', () => {
    expect(parseResult('Result: Pass. Both lines turn amber.')).toMatchObject({ tone: 'pass', rest: 'Both lines turn amber.' });
    expect(parseResult('Result: the total changed')).toBeUndefined();
    expect(parseResult('Observed: Pass')).toBeUndefined();
  });
});

describe('liftReport', () => {
  it('takes the Checked line and a bare Result out of paragraphs and bullets, keeping the rest in order', () => {
    const lifted = liftReport(
      summaryBlocks(
        'Checked: the fee.\n\n- Result: Fail (mocked)\n- Observed: one\n- Observed: two\n\nPR comment: https://github.com/o/r/pull/1',
      ),
    );
    expect(lifted.checked).toBe('the fee.');
    expect(lifted.result).toMatchObject({ status: 'Fail', qualifier: 'mocked' });
    expect(lifted.blocks).toEqual([
      { kind: 'list', ordered: false, items: [{ text: 'Observed: one' }, { text: 'Observed: two' }] },
      { kind: 'p', text: 'PR comment: https://github.com/o/r/pull/1' },
    ]);
  });

  it('leaves a Result that carries more text where it is', () => {
    const lifted = liftReport(summaryBlocks('Result: Pass, all good'));
    expect(lifted.result).toBeUndefined();
    expect(lifted.blocks).toHaveLength(1);
  });
});
