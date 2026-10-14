import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AnimatedText, RAPID_MS, textChange } from '../src/client/components/animated-text.tsx';

describe('textChange', () => {
  const base = { previous: 'Newest', next: 'Oldest', previousAt: 1000, now: 2000, reduced: false };

  it('never animates the first value or an unchanged one', () => {
    expect(textChange({ ...base, previous: undefined })).toBe('none');
    expect(textChange({ ...base, next: 'Newest' })).toBe('none');
  });

  it('morphs a single, spaced-out change', () => {
    expect(textChange(base)).toBe('animate');
    expect(textChange({ ...base, now: base.previousAt + RAPID_MS })).toBe('animate');
  });

  it('swaps instantly when changes come faster than the rapid threshold (scrubbing, key repeat)', () => {
    expect(textChange({ ...base, now: base.previousAt + RAPID_MS - 1 })).toBe('instant');
    expect(textChange({ ...base, now: base.previousAt + 10 })).toBe('instant');
  });

  it('swaps plainly under reduced motion', () => {
    expect(textChange({ ...base, reduced: true })).toBe('instant');
  });
});

describe('AnimatedText', () => {
  it('renders the plain label on first render: no morph layers, no hidden copies', () => {
    const html = renderToStaticMarkup(createElement(AnimatedText, { text: 'Newest', className: 'label' }));
    expect(html).toBe('<span class="atext label">Newest</span>');
  });

  it('a label replacing another (from) ends on the new text with it exposed once to assistive tech', () => {
    const html = renderToStaticMarkup(createElement(AnimatedText, { text: 'Run 2', from: 'Run 1' }));
    // Whatever the phase, the only text not hidden from assistive tech is the final label.
    const exposed = html
      .replace(/<span[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>/g, '')
      .replace(/<[^>]+>/g, '')
      .trim();
    expect(exposed).toBe('Run 2');
  });
});
