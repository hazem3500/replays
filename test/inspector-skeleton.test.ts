import { describe, expect, it } from 'vitest';

import { CURSOR_THEMES } from '../src/client/cursor-themes.ts';
import { CURSOR_MOTION_PREVIEWS } from '../src/client/editor/cursor-motion-previews.ts';
import { CLICK_COPY } from '../src/client/editor/cursor-recipe.ts';
import { SKELETON_CLICKS, SKELETON_MOTIONS, SKELETON_STYLES } from '../src/client/editor/skeleton-copy.ts';

describe('the cursor panel while the editor loads', () => {
  it('names the same styles, motions and click choices as the loaded panel, in its order', () => {
    expect({ styles: [...SKELETON_STYLES], motions: [...SKELETON_MOTIONS], clicks: [...SKELETON_CLICKS] }).toEqual({
      styles: CURSOR_THEMES.map((theme) => theme.label),
      motions: CURSOR_MOTION_PREVIEWS.map((preview) => preview.label),
      clicks: Object.values(CLICK_COPY).map((choice) => choice.label),
    });
  });
});
