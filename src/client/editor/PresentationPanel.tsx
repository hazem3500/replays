import type { ReactNode } from 'react';

import type { ReplayCaptionStyle } from '../../shared/caption-style.ts';
import type { ReplayCursorSettings } from '../../shared/cursor.ts';
import type { ReplayEdits } from '../../shared/edits.ts';
import type { SlotDescriptor } from '../plugins/slots.ts';
import { CaptionStyleSection } from './CaptionStyleSection.tsx';
import { CursorInspector } from './CursorInspector.tsx';
import { editorStrings } from './strings.ts';

const strings = editorStrings.presentation;

/** What a presentation section reads and writes: the whole-replay settings in the edit list. */
export interface PresentationContext {
  edits: ReplayEdits;
  setCursor: (cursor: ReplayCursorSettings | undefined) => void;
  setCaptionStyle: (style: ReplayCaptionStyle) => void;
}

/**
 * `editor.inspector.sections`: how the whole replay is presented (not a moment of it). Built-ins are `core:*`.
 */
export const PRESENTATION_SECTIONS: readonly SlotDescriptor<PresentationContext, ReactNode>[] = [
  {
    id: 'core:cursor',
    order: 100,
    render: ({ edits, setCursor }) => <CursorInspector embedded settings={edits.cursor} onChange={setCursor} onClose={() => undefined} />,
  },
  {
    id: 'core:captions',
    order: 200,
    render: ({ edits, setCaptionStyle }) => (
      <CaptionStyleSection style={edits.captionStyle} hasCaptions={Boolean(edits.captions?.length)} onChange={setCaptionStyle} />
    ),
  },
];

/** The desktop panel beside the preview: one heading, one scope line, then the sections between hairlines. */
export function PresentationPanel({ context }: { context: PresentationContext }) {
  const sections = [...PRESENTATION_SECTIONS].sort((a, b) => a.order - b.order).filter((section) => !section.when || section.when(context));
  return (
    <aside className="editor-presentation" aria-label={strings.label} data-slot="editor.inspector.sections">
      <header className="editor-presentation-header">
        <h2>{strings.title}</h2>
        <p>{strings.scope}</p>
      </header>
      {sections.map((section) => (
        <section key={section.id} className="editor-presentation-section" data-slot-item={section.id}>
          {section.render(context)}
        </section>
      ))}
    </aside>
  );
}
