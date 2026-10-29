import { ChevronDownIcon, HighlighterIcon, MapPinIcon, PlusIcon } from 'lucide-react';

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
        const Icon = tool.icon;
        return (
          <Hint key={tool.id} label={action} shortcut={tool.key}>
            <Button
              variant="ghost"
              size="sm"
              className="editor-tool"
              aria-label={action}
              aria-pressed={tool.id === 'waits' ? suggesting : undefined}
              onClick={() => onTool(tool.id)}
              data-testid={TEST_IDS[tool.id]}
            >
              <Icon aria-hidden="true" />
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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" variant="ghost" className="editor-add-effect" data-testid="add-effect" />}>
        <PlusIcon aria-hidden="true" /> Add <ChevronDownIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="w-auto min-w-56" aria-label="Add to timeline">
        {ADD_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem key={item.kind} onClick={() => onAdd(item.kind)} data-testid={`add-${item.kind}`}>
              <Icon aria-hidden="true" /> {item.label} <DropdownMenuShortcut>{item.key}</DropdownMenuShortcut>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onPointHighlight} data-testid="add-point-highlight-menu">
          <MapPinIcon aria-hidden="true" /> Highlight this moment <DropdownMenuShortcut>M</DropdownMenuShortcut>
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
