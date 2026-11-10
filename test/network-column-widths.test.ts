import { describe, expect, it } from 'vitest';

import { columnTemplate, resizeColumn, widthOf } from '../src/client/viewer/network/column-widths.ts';

describe('network column widths', () => {
  it('starts at the built-in template', () => {
    expect(columnTemplate({})).toBe('60px minmax(0, 1fr) 52px 116px 200px');
  });

  it('widens and narrows one column, leaving the others', () => {
    const widths = resizeColumn({}, 'duration', 24);
    expect(widthOf(widths, 'duration')).toBe(140);
    expect(columnTemplate(resizeColumn(widths, 'status', -6))).toBe('60px minmax(0, 1fr) 46px 140px 200px');
  });

  it('stays within each column limits', () => {
    expect(widthOf(resizeColumn({}, 'time', -500), 'time')).toBe(48);
    expect(widthOf(resizeColumn({}, 'during', 500), 'during')).toBe(400);
  });
});
