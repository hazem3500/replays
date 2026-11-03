import type { ReactNode } from 'react';

import { assertReplayEdits, type ReplayEdits } from '../../shared/edits.ts';
import type { ReplayBundle } from '../../shared/replay.ts';
import { HostSurfaceContextProvider, HostSurfaceSlot, type SurfaceContent } from '../plugins/HostSurface.tsx';
import type { HostSurfaceContext } from '../plugins/surface-contracts.ts';
import type { SlotDescriptor } from '../plugins/slots.ts';
import type { Selection } from './state.ts';

interface EditorSurfaceInput {
  bundle: ReplayBundle;
  edits: ReplayEdits;
  selection: Selection;
  duration: number;
  change: (edits: ReplayEdits) => void;
  seek: (time: number) => void;
}

/** Presence predicates and mounted renderers receive the same validated editor commands. */
export function editorSurfaceContext({ bundle, edits, selection, duration, change, seek }: EditorSurfaceInput): HostSurfaceContext {
  return {
    replay: bundle,
    edits,
    duration,
    seek,
    ...(selection ? { selection } : {}),
    changeEdits: (next) => {
      const copy = structuredClone(next);
      assertReplayEdits(copy, duration);
      change(copy);
    },
  };
}

/** Host edits use the editor's validated undo/save boundary, never direct mutation of its history. */
export function EditorHostSurface({ children, ...input }: EditorSurfaceInput & { children: ReactNode }) {
  return <HostSurfaceContextProvider value={editorSurfaceContext(input)}>{children}</HostSurfaceContextProvider>;
}

/** Each header layout supplies its own core actions to one shared host slot. */
export function EditorTopbarActions({ history, exports }: { history: ReactNode; exports: ReactNode }) {
  const builtins: SlotDescriptor<HostSurfaceContext, SurfaceContent>[] = [
    { id: 'core:history', order: 100, render: () => history },
    { id: 'core:export', order: 200, render: () => exports },
  ];
  return <HostSurfaceSlot slot="editor.topbar.actions" builtins={builtins} />;
}
