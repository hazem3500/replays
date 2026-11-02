import { EllipsisIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Hint } from '@/components/icon-button.tsx';
import { Drawer, DrawerClose, DrawerContent, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu.tsx';

export interface TileMenuItem {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect(): void;
}

export const TILE_MENU_STRINGS = {
  more: (label: string) => `More for ${label}`,
  hint: 'More',
} as const;

/**
 * A tile's less common actions behind one "⋯", each with a text label: a menu with a pointer, a bottom sheet on
 * touch (where a small menu would sit under the finger).
 */
export function TileMenu({ label, items, sheet, tabIndex }: { label: string; items: TileMenuItem[]; sheet: boolean; tabIndex: number }) {
  const trigger = <button type="button" className="mt-action" aria-label={TILE_MENU_STRINGS.more(label)} tabIndex={tabIndex} />;
  if (sheet) {
    return (
      <Drawer>
        <DrawerTrigger render={trigger}>
          <EllipsisIcon aria-hidden="true" />
        </DrawerTrigger>
        <DrawerContent className="mt-sheet" data-testid="tile-sheet">
          <DrawerTitle className="mt-sheet-title">{label}</DrawerTitle>
          {items.map((item) => (
            <DrawerClose key={item.id} render={<button type="button" className="mt-sheet-item" onClick={item.onSelect} />}>
              {item.icon}
              {item.label}
            </DrawerClose>
          ))}
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <DropdownMenu>
      <Hint label={TILE_MENU_STRINGS.hint} side="bottom">
        <DropdownMenuTrigger render={trigger}>
          <EllipsisIcon aria-hidden="true" />
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent side="bottom" align="end" className="w-auto min-w-56">
        {items.map((item) => (
          <DropdownMenuItem key={item.id} onClick={item.onSelect}>
            {item.icon}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
