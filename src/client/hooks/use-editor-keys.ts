import { useEffect, useRef } from 'react';

import { editorShortcutFor, type EditorShortcut } from '../editor/state.ts';

/** Edit mode's keyboard map (src/client/editor/state.ts) on the window; `run` is always the latest handler. */
export function useEditorKeys(run: (shortcut: EditorShortcut) => void, mac: boolean) {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  }, [run]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const shortcut = editorShortcutFor(event, target, mac);
      if (!shortcut) return;
      // A slider under the keyboard (a trim edge) owns its arrows.
      if ((shortcut.startsWith('seek-') || shortcut.startsWith('nudge-')) && target?.getAttribute('role') === 'slider') return;
      event.preventDefault();
      latest.current(shortcut);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mac]);
}
