import { FileVideoCameraIcon, HourglassIcon, Redo2Icon, Undo2Icon } from 'lucide-react';
import type { ReactNode } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Hint, IconButton } from '@/components/icon-button.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';

import type { SlotDescriptor } from '../plugins/slots.ts';
import { useThemeControls } from '../theme.tsx';
import { ViewerBackLink, ViewerPageTitle, ViewerTopbarFrame } from '../viewer/presentation.tsx';
import { editorStrings } from './strings.ts';

const strings = editorStrings.topbar;

/** A secondary action in the topbar's ⋯ menu. */
export interface EditorMenuItem {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  shortcut?: string;
  disabled?: boolean;
  testId?: string;
}

/** What the topbar's actions read: plain values and callbacks, no React state. */
export interface EditorTopbarContext {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  done: () => void;
  /** The Export control (it owns its render job). */
  exportAction: ReactNode;
  menu: readonly EditorMenuItem[];
}

/** `editor.topbar.actions`: right side of the editor's bar, in order. Built-ins are `core:*`. */
export const EDITOR_TOPBAR_ACTIONS: readonly SlotDescriptor<EditorTopbarContext, ReactNode>[] = [
  { id: 'core:undo-redo', order: 100, render: (context) => <HistoryGroup {...context} /> },
  {
    id: 'core:done',
    order: 200,
    render: ({ done }) => (
      <Hint label={strings.doneHint} side="bottom" align="end">
        <Button variant="ghost" className="editor-done" onClick={done} data-testid="editor-done">
          {strings.done}
        </Button>
      </Hint>
    ),
  },
  { id: 'core:export', order: 300, render: ({ exportAction }) => exportAction },
  { id: 'core:more', order: 400, render: ({ menu }) => <MoreMenu items={menu} /> },
];

/**
 * The desktop editor's bar. Left: back, "Edit", the title and the quiet save state. Right: one family of 32 px
 * controls — undo/redo, Done, Export (the one filled button) and ⋯ (which also holds the theme).
 */
export function EditorTopbar({
  title,
  backHref,
  status,
  context,
}: {
  title: string;
  backHref: string;
  status: ReactNode;
  context: EditorTopbarContext;
}) {
  const actions = [...EDITOR_TOPBAR_ACTIONS].sort((a, b) => a.order - b.order).filter((action) => !action.when || action.when(context));
  return (
    <ViewerTopbarFrame>
      <Hint label={strings.back} side="bottom" align="start">
        <ViewerBackLink href={backHref} label={strings.back}>
          <AnimatedIcon name="chevron-left" />
        </ViewerBackLink>
      </Hint>
      <ViewerPageTitle id="replay-title">
        <span className="topbar-prefix">{strings.prefix}</span>
        <span className="topbar-title-text" title={title}>
          {title}
        </span>
      </ViewerPageTitle>
      <div className="topbar-status">{status}</div>
      <div className="topbar-actions editor-topbar-actions" data-slot="editor.topbar.actions" data-testid="editor-topbar">
        {actions.map((action) => (
          <div key={action.id} className="editor-topbar-item" data-slot-item={action.id}>
            {action.render(context)}
          </div>
        ))}
      </div>
    </ViewerTopbarFrame>
  );
}

function HistoryGroup({ canUndo, canRedo, undo, redo }: EditorTopbarContext) {
  return (
    <div className="editor-history" role="group" aria-label={strings.history}>
      <IconButton label={strings.undo} shortcut={strings.undoKeys} tooltipSide="bottom" disabled={!canUndo} onClick={undo} data-testid="undo">
        <Undo2Icon aria-hidden="true" />
      </IconButton>
      <IconButton label={strings.redo} shortcut={strings.redoKeys} tooltipSide="bottom" disabled={!canRedo} onClick={redo} data-testid="redo">
        <Redo2Icon aria-hidden="true" />
      </IconButton>
    </div>
  );
}

function MoreMenu({ items }: { items: readonly EditorMenuItem[] }) {
  const { theme, switchTheme } = useThemeControls();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <DropdownMenu>
      <Hint label={strings.moreHint} side="bottom" align="end">
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="editor-more" aria-label={strings.more} />}>
          <AnimatedIcon name="ellipsis" />
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent side="bottom" align="end" className="w-auto min-w-56">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.id}
            onClick={item.onSelect}
            {...(item.disabled ? { disabled: true } : {})}
            {...(item.testId ? { 'data-testid': item.testId } : {})}
          >
            {item.icon}
            {item.label}
            {item.shortcut ? <DropdownMenuShortcut data-keys="">{item.shortcut}</DropdownMenuShortcut> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {/* Stays open so the flip shows behind the menu. */}
        <DropdownMenuItem closeOnClick={false} data-testid="theme-menu-item" onClick={switchTheme}>
          <AnimatedIcon name={next === 'light' ? 'sun' : 'moon'} />
          {next === 'light' ? strings.lightTheme : strings.darkTheme}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The ⋯ menu's built-in items (the phone's More sheet shows the same list). */
export function editorMenuItems({
  viewOriginal,
  removeWaits,
  resetEdits,
  canReset,
}: {
  viewOriginal: () => void;
  removeWaits: () => void;
  resetEdits: () => void;
  canReset: boolean;
}): EditorMenuItem[] {
  return [
    { id: 'core:view-original', label: strings.viewOriginal, icon: <FileVideoCameraIcon aria-hidden="true" />, onSelect: viewOriginal, testId: 'editor-view-original' },
    { id: 'core:remove-waits', label: strings.removeWaits, icon: <HourglassIcon aria-hidden="true" />, onSelect: removeWaits, shortcut: 'W', testId: 'remove-waits-item' },
    { id: 'core:reset', label: strings.resetEdits, icon: <AnimatedIcon name="rotate-ccw" />, onSelect: resetEdits, disabled: !canReset, testId: 'reset-edits' },
  ];
}
