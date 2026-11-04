import { describe, expect, it } from 'vitest';

import { CAPTION_DISPLAY_MAX, captionDisplayText } from '../src/client/step-caption.ts';

describe('captionDisplayText', () => {
  it('leaves a short caption as it is', () => {
    expect(captionDisplayText('Clicked “Save”')).toBe('Clicked “Save”');
  });

  it('shortens a long old label at a word boundary and keeps the quote closed', () => {
    const label = `Clicked “asdadasd, 10:00 AM–1:15 PM, 3h 15m asdadasd asdasd ${'more words '.repeat(12)}”`;
    const shown = captionDisplayText(label);
    expect(shown.length).toBeLessThanOrEqual(CAPTION_DISPLAY_MAX);
    expect(shown.startsWith('Clicked “asdadasd, 10:00 AM–1:15 PM, 3h 15m asdadasd asdasd')).toBe(true);
    expect(shown.endsWith('”')).toBe(true);
    expect(shown).not.toContain('…');
  });

  it('drops the ellipsis an old recording stored inside the quotes', () => {
    expect(captionDisplayText('Clicked “Search developer…”')).toBe('Clicked “Search developer”');
  });

  it('drops a trailing ellipsis and shortens an unquoted label', () => {
    expect(captionDisplayText('Wait for the page…')).toBe('Wait for the page');
    const shown = captionDisplayText(`Open ${'workspace '.repeat(20)}`);
    expect(shown.length).toBeLessThanOrEqual(CAPTION_DISPLAY_MAX);
    expect(shown).not.toMatch(/…|\.\.\./);
  });
});
