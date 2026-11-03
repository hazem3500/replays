import { useRef } from 'react';
import { CaptionsIcon, EllipsisIcon, EyeOffIcon, ScissorsIcon, ZoomInIcon } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu.tsx';
import type { ReplayEdits } from '../../shared/edits.ts';
import { formatClock } from '../../shared/replay.ts';
import { useFocusWhen } from '../hooks/use-focus-when.ts';
import { type ChangeEdits, effectList, type Selection } from './state.ts';
import {
  ObjectHeaderAction,
  objectTitle,
  SelectionBody,
  selectionSpan,
  type SelectionCommands,
  type SelectionPanels,
} from './SelectionInspector.tsx';

function effectLabel(kind: 'zoom' | 'speed' | 'blur' | 'caption', text: string) {
  if (text) return `Caption · ${text}`;
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** Named access to short/coincident objects without distorting their timeline widths. */
export function mobileTimelineObjects(edits: ReplayEdits) {
  const objects: Array<{ key: string; label: string; at: number; selection: Selection }> = [];
  for (const kind of ['zoom', 'speed', 'blur', 'caption'] as const) {
    for (const item of effectList(edits, kind)) {
      const text = kind === 'caption' && 'text' in item ? item.text : '';
      objects.push({
        key: `${kind}:${item.id}`,
        label: effectLabel(kind, text),
        at: item.from,
        selection: { kind, id: item.id },
      });
    }
  }
  for (const item of edits.cuts)
    objects.push({
      key: `cut:${item.id}`,
      label: item.label ? `Cut · ${item.label}` : 'Cut',
      at: item.from,
      selection: { kind: 'cut', id: item.id },
    });
  for (const item of edits.highlights ?? [])
    objects.push({
      key: `highlight:${item.id}`,
      label: item.label ? `Highlight · ${item.label}` : 'Highlight',
      at: item.kind === 'point' ? item.at : item.from,
      selection: { kind: 'highlight', id: item.id },
    });
  return objects.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}

const NO_OBJECTS: ReturnType<typeof mobileTimelineObjects> = [];

/** Adding an object is a command, never a permanent inspector destination. */
export function MobileAddToolbar({
  onTrim,
  onCaption,
  onBlur,
  onZoom,
  more,
  objects = NO_OBJECTS,
  onSelectObject,
}: {
  onTrim: () => void;
  onCaption: () => void;
  onBlur: () => void;
  onZoom: () => void;
  more: Array<{ label: string; action: () => void; disabled?: boolean; testId?: string }>;
  objects?: ReturnType<typeof mobileTimelineObjects>;
  onSelectObject?: (object: ReturnType<typeof mobileTimelineObjects>[number]) => void;
}) {
  return (
    <div className="editor-add-toolbar" role="group" aria-label="Add or edit">
      <Button variant="ghost" onClick={onTrim} data-testid="mobile-trim">
        <ScissorsIcon aria-hidden="true" />
        Trim
      </Button>
      <Button variant="ghost" onClick={onCaption} data-testid="add-caption">
        <CaptionsIcon aria-hidden="true" />
        Caption
      </Button>
      <Button variant="ghost" onClick={onBlur} data-testid="add-blur">
        <EyeOffIcon aria-hidden="true" />
        Blur
      </Button>
      <Button variant="ghost" onClick={onZoom} data-testid="add-zoom">
        <ZoomInIcon aria-hidden="true" />
        Zoom
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" className="editor-add-more" aria-label="More editing tools" />}>
          <EllipsisIcon aria-hidden="true" />
          <span>More</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          className="w-[min(300px,calc(100vw-24px))] max-h-[min(440px,var(--available-height))]"
          aria-label="More editing tools"
        >
          {more.map((item) => (
            <DropdownMenuItem
              key={item.label}
              className="min-h-11"
              disabled={item.disabled}
              data-testid={item.testId}
              onClick={item.action}
            >
              {item.label}
            </DropdownMenuItem>
          ))}
          {objects.length > 0 ? (
            <DropdownMenuGroup aria-label="On timeline">
              <DropdownMenuSeparator />
              <DropdownMenuLabel>On timeline · {objects.length}</DropdownMenuLabel>
              {objects.map((object) => (
                <DropdownMenuItem key={object.key} className="editor-object-picker-item min-h-11" onClick={() => onSelectObject?.(object)}>
                  <span>{object.label}</span>
                  <time>{formatClock(object.at)}</time>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Only the selected timeline object's properties. No selection means no settings panel. */
export function MobileInspector({
  edits,
  selection,
  duration,
  change,
  commands,
  panels,
  cursorOpen,
  placingBlur,
}: {
  edits: ReplayEdits;
  selection: Selection;
  duration: number;
  change: ChangeEdits;
  commands: SelectionCommands;
  panels: SelectionPanels;
  cursorOpen: boolean;
  placingBlur: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusWhen(heading, cursorOpen || placingBlur);
  if (!selection && !cursorOpen && !placingBlur) return null;
  const { from, to } = selectionSpan(edits, selection, duration);
  const title = objectTitle(selection?.kind, cursorOpen, placingBlur);
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- why: Escape bubbles from the property controls; the section is not a focus target.
    <section
      className="editor-context-panel"
      aria-label={`${title} properties`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          commands.onDone();
        }
      }}
    >
      <header>
        <h2 ref={heading} tabIndex={-1}>
          {title}
        </h2>
        {cursorOpen || placingBlur ? null : <ObjectHeaderAction kind={selection?.kind} title={title} onAction={commands.onDelete} />}
        <Button variant="ghost" onClick={commands.onDone} data-testid="mobile-object-done">
          Done
        </Button>
      </header>
      {cursorOpen ? panels.cursorInspector : null}
      {placingBlur && !cursorOpen ? <p>Drag over the area to hide on the preview. Done cancels placement.</p> : null}
      {cursorOpen || placingBlur ? null : (
        <SelectionBody retime={{ edits, selection, duration, change, commands }} from={from} to={to} panels={panels} commands={commands} />
      )}
    </section>
  );
}
