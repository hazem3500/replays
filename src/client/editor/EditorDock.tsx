import { ChevronDownIcon, HourglassIcon, MapPinIcon, PlusIcon, ScissorsIcon } from 'lucide-react';
import type { ReactNode, Ref } from 'react';

import { IconButton } from '@/components/icon-button.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';

import type { EditTimeline, ReplayEdits } from '../../shared/edits.ts';
import type { EditorActions } from './actions.ts';
import { Durations, EditorClock, EditorPlayButton, EffectControls, HighlightControls } from './controls.tsx';
import type { Selection } from './state.ts';
import { editorStrings } from './strings.ts';
import { editorTools } from './tools.tsx';

const strings = editorStrings.dock;

/** The dock's frame: a control row, the timeline, then the phone's tools and one line of hint or note. */
export function EditorDock({
  dockRef,
  mobile,
  controls,
  notice,
  timeline,
  tools,
  note,
  hint,
}: {
  dockRef: Ref<HTMLElement>;
  mobile: boolean;
  controls: ReactNode;
  notice: ReactNode;
  timeline: ReactNode;
  tools: ReactNode;
  note: string | undefined;
  hint: string | null;
}) {
  return (
    <section ref={dockRef} className="editor-dock" aria-label={mobile ? strings.mobileLabel : strings.label}>
      {controls}
      {notice}
      <div id="editor-timeline" className="editor-timeline-content" role="group" aria-label={strings.timeline}>
        {timeline}
      </div>
      {tools}
      <p className="editor-hint" data-testid="editor-hint" data-note={note ? '' : undefined}>
        {note ?? hint}
      </p>
      <span className="sr-only" role="status">
        {note}
      </span>
    </section>
  );
}

/** The desktop control row: play and clock · cut, waits, highlight · Add · the selection's setting · lengths. */
export function EditorBar({
  actions,
  playPause,
  edits,
  selection,
  change,
  duration,
  timeline,
  suggestions,
  onDismissSuggestions,
}: {
  actions: EditorActions;
  playPause: () => void;
  edits: ReplayEdits;
  selection: Selection;
  change: (edits: ReplayEdits, select?: Selection) => void;
  duration: number;
  timeline: EditTimeline;
  /** Waits found, waiting to be applied (0 when not suggesting). */
  suggestions: number;
  onDismissSuggestions: () => void;
}) {
  return (
    <div className="editor-bar" role="group" aria-label={strings.tools}>
      <EditorPlayButton onSwitch={playPause} />
      <EditorClock />
      <span className="editor-bar-divider" aria-hidden="true" />
      <IconButton label={selection?.kind === 'range' ? strings.cutSelection : strings.cutAtPlayhead} shortcut="C" onClick={actions.cut} data-testid="add-cut">
        <ScissorsIcon aria-hidden="true" />
      </IconButton>
      <IconButton
        label={suggestions ? strings.applyWaits : strings.findWaits}
        shortcut="W"
        onClick={actions.removeWaits}
        data-testid="remove-waits"
        aria-pressed={suggestions > 0}
      >
        <HourglassIcon aria-hidden="true" />
      </IconButton>
      <IconButton label={strings.highlightMoment} shortcut="M" onClick={actions.pointHighlight} data-testid="add-point-highlight">
        <MapPinIcon aria-hidden="true" />
      </IconButton>
      <span className="editor-bar-divider" aria-hidden="true" />
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="sm" variant="ghost" className="editor-add-effect" data-testid="add-effect" />}>
          <PlusIcon aria-hidden="true" /> {strings.add} <ChevronDownIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" className="w-auto min-w-52" aria-label={strings.addMenu} data-slot="editor.tools">
          {editorTools().map((tool) => (
            <DropdownMenuItem key={tool.id} onClick={() => actions.effect(tool.kind)} data-testid={tool.testId} data-slot-item={tool.id}>
              {tool.render({})} {tool.label} <DropdownMenuShortcut>{tool.shortcut}</DropdownMenuShortcut>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={actions.periodHighlight} data-testid="add-period-highlight">
            <ScissorsIcon aria-hidden="true" /> {strings.highlightSelection}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <EffectControls edits={edits} selection={selection} change={change} />
      <HighlightControls edits={edits} selection={selection} duration={duration} change={change} />
      <div className="editor-bar-end">
        {suggestions ? (
          <span className="editor-suggest" role="status" data-testid="wait-suggestions">
            {strings.waitsFound(suggestions)}
            <Button size="sm" variant="secondary" onClick={actions.applySuggestions} data-testid="apply-waits">
              {strings.removeAll} <kbd>↵</kbd>
            </Button>
            <Button size="sm" variant="ghost" onClick={onDismissSuggestions}>
              {strings.dismiss}
            </Button>
          </span>
        ) : (
          <Durations original={timeline.originalDuration} edited={timeline.duration} />
        )}
      </div>
    </div>
  );
}
