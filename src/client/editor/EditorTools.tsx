import { HighlighterIcon } from 'lucide-react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Hint } from '@/components/icon-button.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { ADD_ITEMS, BAR_TOOLS, type EditorTool } from './editor-tools.ts';
import type { EffectKind } from './state.ts';
import { useHasKeyboard } from '../hooks/use-has-keyboard.ts';

const TEST_IDS: Record<EditorTool['id'], string> = { cut: 'add-cut', waits: 'remove-waits', highlight: 'add-point-highlight' };

/** What a tool does now: cutting a selection or applying waits found reads differently. */
function actionFor(tool: EditorTool, rangeSelected: boolean, suggesting: boolean) {
  if (tool.id === 'cut' && rangeSelected) return 'Cut the selection';
  if (tool.id === 'waits' && suggesting) return 'Remove the waits found';
  return tool.action;
}

/** The bar's editing tools, each with its name on the button and its key in the tooltip. */
export function BarTools({
  rangeSelected,
  suggesting,
  onTool,
}: {
  rangeSelected: boolean;
  suggesting: boolean;
  onTool: (id: EditorTool['id']) => void;
}) {
  return (
    <>
      {BAR_TOOLS.map((tool) => {
        const action = actionFor(tool, rangeSelected, suggesting);
        return (
          <Hint key={tool.id} label={action} shortcut={tool.key}>
            <Button
              variant="ghost"
              size="sm"
              className="editor-tool"
              aria-label={action}
              aria-pressed={tool.id === 'waits' ? suggesting : undefined}
              aria-keyshortcuts={tool.key}
              onClick={() => onTool(tool.id)}
              data-testid={TEST_IDS[tool.id]}
            >
              <AnimatedIcon name={tool.icon} />
              {tool.label}
            </Button>
          </Hint>
        );
      })}
    </>
  );
}

/** Everything that can be added at the playhead, with its key, plus the empty-track toggle. */
export function AddMenu({
  onAdd,
  onPointHighlight,
  onPeriodHighlight,
  showEmptyTracks,
  onShowEmptyTracks,
}: {
  onAdd: (kind: EffectKind) => void;
  onPointHighlight: () => void;
  onPeriodHighlight: () => void;
  showEmptyTracks: boolean;
  onShowEmptyTracks: (show: boolean) => void;
}) {
  const hasKeyboard = useHasKeyboard();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" variant="ghost" className="editor-add-effect" data-testid="add-effect" />}>
        <AnimatedIcon name="plus" /> Add <AnimatedIcon name="chevron-down" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="w-auto min-w-56" aria-label="Add to timeline">
        {ADD_ITEMS.map((item) => (
          <DropdownMenuItem key={item.kind} onClick={() => onAdd(item.kind)} data-testid={`add-${item.kind}`}>
            <AnimatedIcon name={item.icon} /> {item.label} {hasKeyboard ? <DropdownMenuShortcut>{item.key}</DropdownMenuShortcut> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onPointHighlight} data-testid="add-point-highlight-menu">
          <AnimatedIcon name="map-pin" /> Highlight this moment {hasKeyboard ? <DropdownMenuShortcut>M</DropdownMenuShortcut> : null}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onPeriodHighlight} data-testid="add-period-highlight">
          <HighlighterIcon aria-hidden="true" /> Highlight the selection
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={showEmptyTracks}
          onCheckedChange={onShowEmptyTracks}
          closeOnClick
          data-testid="show-empty-tracks"
        >
          Show empty tracks
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Under a timeline with no effects yet: what can be added at the playhead, as quiet chips. Each chip's tooltip says
 * what it does with its key, and the key also follows its name as a quiet suffix where the row has room.
 */
export function LaneInvitation({ onAdd }: { onAdd: (kind: EffectKind) => void }) {
  const hasKeyboard = useHasKeyboard();
  return (
    <div className="tl-invite" role="group" aria-label="Add at the playhead" data-testid="lane-invitation">
      <span className="tl-invite-text">Add at the playhead</span>
      {ADD_ITEMS.map((item) => (
        <Hint key={item.kind} label={item.label} shortcut={item.key}>
          <Button
            variant="ghost"
            size="sm"
            className="tl-invite-chip"
            aria-keyshortcuts={item.key}
            onClick={() => onAdd(item.kind)}
            data-testid={`invite-${item.kind}`}
          >
            <AnimatedIcon name={item.icon} size={14} />
            {item.short}
            {hasKeyboard ? (
              <kbd className="tl-invite-key" data-slot="key-suffix" aria-hidden="true">
                {item.key}
              </kbd>
            ) : null}
          </Button>
        </Hint>
      ))}
    </div>
  );
}
