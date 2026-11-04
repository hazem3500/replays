import { useRef } from 'react';
import { CaptionsIcon, EllipsisIcon, EyeOffIcon, ScissorsIcon, ZoomInIcon } from 'lucide-react';
import { AnimatedIcon, type AnimatedIconName } from '@/components/animated-icon.tsx';
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

/** Each effect's name in the timeline list, as the Add menu calls it. */
const EFFECT_NAMES = { zoom: 'Zoom', speed: 'Speed up', blur: 'Blur', caption: 'Caption' } as const;

function effectLabel(kind: 'zoom' | 'speed' | 'blur' | 'caption', text: string) {
  if (text) return `Caption · ${text}`;
  return EFFECT_NAMES[kind];
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

/** A tool in the phone's More menu. */
export interface MoreTool {
  /** The tool's name, as the desktop bar and Add menu call it. */
  label: string;
  /** One short line under the name: what it does, or why it is unavailable. */
  hint?: string;
  /** The same animated icon as the desktop's tool or Add item. */
  icon?: AnimatedIconName;
  action: () => void;
  disabled?: boolean;
  testId?: string;
}

/** Adding an object is a command, never a permanent inspector destination. */
export function MobileAddToolbar({
  onCut,
  onCaption,
  onBlur,
  onZoom,
  more,
  objects = NO_OBJECTS,
  onSelectObject,
}: {
  /** Cuts a second at the playhead, as the desktop bar's Cut does. */
  onCut: () => void;
  onCaption: () => void;
  onBlur: () => void;
  onZoom: () => void;
  /** The other tools, by the desktop's names; `hint` says what one does, or why it is unavailable when `disabled`. */
  more: MoreTool[];
  objects?: ReturnType<typeof mobileTimelineObjects>;
  onSelectObject?: (object: ReturnType<typeof mobileTimelineObjects>[number]) => void;
}) {
  return (
    <div className="editor-add-toolbar" role="group" aria-label="Add or edit">
      <Button variant="ghost" onClick={onCut} aria-label="Cut a second at the playhead" data-testid="add-cut">
        <ScissorsIcon aria-hidden="true" />
        Cut
      </Button>
      <Button variant="ghost" onClick={onCaption} data-testid="add-caption">
        <CaptionsIcon aria-hidden="true" />
        Captions
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
              className="editor-more-item min-h-11 shrink-0 items-start whitespace-normal text-left data-disabled:opacity-100"
              disabled={item.disabled}
              data-testid={item.testId}
              onClick={item.action}
            >
              {item.icon ? <AnimatedIcon name={item.icon} className="editor-more-icon" /> : null}
              <span className="editor-more-text">
                <span className="editor-more-name">{item.label}</span>
                {item.hint ? <span className="editor-more-hint">{item.hint}</span> : null}
              </span>
            </DropdownMenuItem>
          ))}
          {objects.length > 0 ? (
            <DropdownMenuGroup aria-label="On timeline">
              <DropdownMenuSeparator />
              <DropdownMenuLabel>On timeline · {objects.length}</DropdownMenuLabel>
              {objects.map((object) => (
                <DropdownMenuItem
                  key={object.key}
                  className="editor-object-picker-item min-h-11 shrink-0"
                  onClick={() => onSelectObject?.(object)}
                >
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
