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

const listedKeys = EDITOR_SHORTCUT_GROUPS.flatMap((group) => group.items.flatMap((item) => item.keys));
const isUnhandled = (key: string) => key.length === 1 && key !== '←' && key !== '→' && !editorShortcutFor(press(key));

describe('the editor shortcut sheet', () => {
  it('lists only keys the editor acts on', () => {
    expect(listedKeys.filter(isUnhandled)).toEqual([]);
  });

  it('opens from the question mark', () => {
    expect(editorShortcutFor(press('?'))).toBe('shortcuts');
  });
});
