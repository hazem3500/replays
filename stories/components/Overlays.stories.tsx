import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Button } from '../../src/client/components/ui/button.tsx';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../src/client/components/ui/dialog.tsx';
import { Drawer, DrawerClose, DrawerContent, DrawerFooter, DrawerTitle, DrawerTrigger } from '../../src/client/components/ui/drawer.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '../../src/client/components/ui/dropdown-menu.tsx';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '../../src/client/components/ui/popover.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../src/client/components/ui/tooltip.tsx';
import { opened, settled } from '../play.ts';

const meta = {
  title: 'Components/Overlays',
  parameters: { layout: 'centered', docs: { story: { inline: false, height: '360px' } } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

export const TooltipOnHover: Story = {
  name: 'Tooltip',
  render: () => (
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline">Copy link</Button>} />
      <TooltipContent>Copies a link to this moment</TooltipContent>
    </Tooltip>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByRole('button', { name: 'Copy link' }));
    const tip = await page().findByText('Copies a link to this moment');
    await settled();
    await expect(tip).toBeVisible();
  },
};

export const PopoverOnClick: Story = {
  name: 'Popover',
  render: () => (
    <Popover>
      <PopoverTrigger render={<Button variant="outline">Retention</Button>} />
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>Kept for 30 days</PopoverTitle>
          <PopoverDescription>Keep this replay to stop it expiring.</PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Retention' }));
    const popover = await page().findByRole('dialog', { name: 'Kept for 30 days' });
    await opened(popover);
    await expect(popover).toBeVisible();
  },
};

export const Menu: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline">Replay actions</Button>} />
      <DropdownMenuContent>
        <DropdownMenuItem>
          Copy link
          <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>Download bundle</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Replay actions' }));
    const menu = await page().findByRole('menu');
    await expect(within(menu).getAllByRole('menuitem')).toHaveLength(3);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[data-base-ui-focus-guard]')).toBeNull());
    await settled();
  },
};

export const ConfirmDialog: Story = {
  name: 'Dialog',
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button variant="destructive">Delete replay</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this replay?</DialogTitle>
          <DialogDescription>Comments and edits go with it. This can't be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button variant="destructive">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Delete replay' }));
    const dialog = await page().findByRole('dialog', { name: 'Delete this replay?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(page().queryByRole('dialog')).toBeNull());
    await settled();
  },
};

export const BottomDrawer: Story = {
  name: 'Drawer',
  globals: { viewport: { value: 'phone', isRotated: false } },
  render: () => (
    <Drawer>
      <DrawerTrigger render={<Button variant="outline">Sort</Button>} />
      <DrawerContent>
        <DrawerTitle>Sort replays</DrawerTitle>
        <DrawerFooter>
          <DrawerClose render={<Button>Done</Button>} />
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Sort' }));
    const drawer = await page().findByRole('dialog', { name: 'Sort replays' });
    await opened(drawer);
    await expect(drawer).toBeVisible();
  },
};
