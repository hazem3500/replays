import { useId, useState } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Hint } from '@/components/icon-button.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { BAR_TOOLS, type EditorTool } from './bar-tools.ts';
import { ADD_ITEMS } from './editor-tools.ts';
import type { EffectKind } from './state.ts';
import { useHasKeyboard } from '../hooks/use-has-keyboard.ts';

const TEST_IDS: Record<EditorTool['id'], string> = { cut: 'add-cut', waits: 'remove-waits', highlight: 'add-point-highlight' };

/** What a tool does now: cutting or highlighting a selection, or applying waits found, reads differently. */
function actionFor(tool: EditorTool, rangeSelected: boolean, suggesting: boolean) {
  if (tool.id === 'cut' && rangeSelected) return 'Cut the selection';
  // why: one Highlight covers both kinds, as Cut does: the selection when there is one, else the playhead's moment.
  if (tool.id === 'highlight') return rangeSelected ? 'Highlight the selection' : 'Highlight this moment';
  if (tool.id === 'waits' && suggesting) return 'Remove the waits found';
  return tool.action;
}

/** A control's key after its name, quieter than the name; hidden from assistive technology, which reads aria-keyshortcuts. */
function KeySuffix({ shortcut }: { shortcut: string }) {
  return (
    <kbd className="editor-key" data-slot="key-suffix" aria-hidden="true">
      {shortcut}
    </kbd>
  );
}

/** The bar's editing tools, each with its name and key on the button and what it does in the tooltip. */
export function BarTools({
  rangeSelected,
  suggesting,
  onTool,
}: {
  rangeSelected: boolean;
  suggesting: boolean;
  onTool: (id: EditorTool['id']) => void;
}) {
  const hasKeyboard = useHasKeyboard();
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
              {hasKeyboard ? <KeySuffix shortcut={tool.key} /> : null}
            </Button>
          </Hint>
        );
      })}
    </>
  );
}

const MENU_HINT = 'Adds at the playhead, or over the selection';

/**
 * The effects that can be added, by short name and key (Highlight is a toolbar tool, so it is not repeated here).
 * What the item under the pointer or focus does shows once, on the menu's last line, instead of in every row.
 */
export function AddMenu({ onAdd }: { onAdd: (kind: EffectKind) => void }) {
  const hasKeyboard = useHasKeyboard();
  const [hinted, setHinted] = useState<EffectKind>();
  const ids = useId();
  return (
    <DropdownMenu onOpenChange={() => setHinted(undefined)}>
      <DropdownMenuTrigger render={<Button size="sm" variant="ghost" className="editor-add-effect" data-testid="add-effect" />}>
        <AnimatedIcon name="plus" /> Add <AnimatedIcon name="chevron-down" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="editor-add-menu w-56" aria-label="Add to timeline">
        {ADD_ITEMS.map((item) => (
          <DropdownMenuItem
            key={item.kind}
            className="min-h-10"
            data-kind={item.kind}
            onClick={() => onAdd(item.kind)}
            onFocus={() => setHinted(item.kind)}
            onPointerEnter={() => setHinted(item.kind)}
            aria-describedby={`${ids}-${item.kind}`}
            aria-keyshortcuts={item.key}
            data-testid={`add-${item.kind}`}
          >
            <AnimatedIcon name={item.icon} /> {item.label}
            {hasKeyboard ? <KeySuffix shortcut={item.key} /> : null}
          </DropdownMenuItem>
        ))}
        {ADD_ITEMS.map((item) => (
          <span key={item.kind} id={`${ids}-${item.kind}`} hidden>
            {item.action}
          </span>
        ))}
        <DropdownMenuSeparator />
        <p className="editor-add-hint" aria-hidden="true" data-testid="add-hint">
          {ADD_ITEMS.find((item) => item.kind === hinted)?.action ?? MENU_HINT}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The editor's More menu view setting: an empty lane per effect kind, to draw a range on directly. */
export function EmptyTracksItem({ checked, onChange }: { checked: boolean; onChange: (show: boolean) => void }) {
  return (
    <DropdownMenuCheckboxItem checked={checked} onCheckedChange={onChange} closeOnClick data-testid="show-empty-tracks">
      Show empty tracks
    </DropdownMenuCheckboxItem>
  );
}
