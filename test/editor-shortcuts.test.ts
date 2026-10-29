import { describe, expect, it } from 'vitest';

import { EDITOR_SHORTCUT_GROUPS } from '../src/client/editor/editor-tools.ts';
import { editorShortcutFor } from '../src/client/editor/state.ts';

/** A key cap as the key it names: letters are written in capitals but typed without Shift. */
const press = (cap: string) => ({
  key: /^[A-Z]$/.test(cap) ? cap.toLowerCase() : cap,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
});

describe('the editor shortcut sheet', () => {
  it('lists only keys the editor acts on', () => {
    const single = EDITOR_SHORTCUT_GROUPS.flatMap((group) => group.items.flatMap((item) => item.keys)).filter(
      (key) => key.length === 1 && key !== '←' && key !== '→',
    );
    expect(single.filter((key) => !editorShortcutFor(press(key)))).toEqual([]);
  });

  it('opens from the question mark', () => {
    expect(editorShortcutFor(press('?'))).toBe('shortcuts');
  });
});
