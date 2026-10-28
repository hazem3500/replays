import { describe, expect, it } from 'vitest';

import { dragBox } from '../src/client/editor/BlurOverlay.tsx';

const box = { x: 0.2, y: 0.2, width: 0.4, height: 0.3 };

describe('dragging a blur box', () => {
  it('moves only the top edge from the top handle', () => {
    expect(dragBox(box, 'n', 0.3, -0.1)).toEqual({ x: 0.2, y: 0.1, width: 0.4, height: 0.4 });
  });

  it('moves only the right edge from the right handle', () => {
    expect(dragBox(box, 'e', 0.1, 0.3)).toEqual({ x: 0.2, y: 0.2, width: 0.5, height: 0.3 });
  });

  it('resizes both edges from a corner and keeps the box inside the frame', () => {
    expect(dragBox(box, 'se', 0.9, 0.9)).toEqual({ x: 0.2, y: 0.2, width: 0.8, height: 0.8 });
  });

  it('moves the whole box without changing its size or leaving the frame', () => {
    expect(dragBox(box, 'move', 0.6, -0.5)).toEqual({ x: 0.6, y: 0, width: 0.4, height: 0.3 });
  });
});
