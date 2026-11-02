import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Button } from '../src/client/components/ui/button.tsx';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../src/client/components/ui/alert-dialog.tsx';
import { deleteReplayCopy } from '../src/client/components/delete-replay-dialog.tsx';
import { Popover, PopoverTrigger, PopoverContent, PopoverTitle, PopoverDescription } from '../src/client/components/ui/popover.tsx';
import { Drawer, DrawerTrigger, DrawerContent, DrawerTitle, DrawerClose } from '../src/client/components/ui/drawer.tsx';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from '../src/client/components/ui/dropdown-menu.tsx';
import { Tooltip, TooltipTrigger, TooltipContent } from '../src/client/components/ui/tooltip.tsx';
const meta = {
  title: 'Components/Overlays',
  decorators: [
    (Story) => (
      <div className="sb-stage">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
function DialogDemo({ open = false, long = false }: { open?: boolean; long?: boolean }) {
  const copy = deleteReplayCopy('Checkout fails on staging');
  return (
    <AlertDialog defaultOpen={open}>
      <AlertDialogTrigger render={<Button />}>Delete replay</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {long
              ? 'This replay contains a long investigation and shared review context. '.repeat(20)
              : copy.body}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel />
          <AlertDialogAction variant="destructive">Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
export const DialogClosed: Story = {
  render: () => <DialogDemo />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Delete replay' }));
    const page = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(page.getByRole('alertdialog')).toBeVisible());
    await userEvent.click(page.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(page.queryByRole('alertdialog')).not.toBeInTheDocument());
  },
};
export const DialogOpen: Story = { render: () => <DialogDemo open /> };
export const DialogOverflow: Story = { render: () => <DialogDemo open long /> };
export const DialogMobile: Story = {
  ...DialogOpen,
  globals: { viewport: { value: 'mobile390', isRotated: false } },
};
function PopoverDemo({ open = false }: { open?: boolean }) {
  return (
    <Popover defaultOpen={open}>
      <PopoverTrigger render={<Button variant="outline" />}>Replay details</PopoverTrigger>
      <PopoverContent>
        <PopoverTitle>Checkout failure</PopoverTitle>
        <PopoverDescription>Recorded on staging · 12 seconds · 3 errors</PopoverDescription>
      </PopoverContent>
    </Popover>
  );
}
export const PopoverClosed: Story = { render: () => <PopoverDemo /> };
export const PopoverOpen: Story = { render: () => <PopoverDemo open /> };
export const Menu: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger render={<Button />}>Replay actions</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Copy link</DropdownMenuItem>
        <DropdownMenuItem>Download JSON</DropdownMenuItem>
        <DropdownMenuItem disabled>Export video (unavailable)</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked>Show captions</DropdownMenuCheckboxItem>
        <DropdownMenuItem>Delete replay</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};
export const DrawerMobile: Story = {
  globals: { viewport: { value: 'mobile390', isRotated: false } },
  render: () => (
    <Drawer defaultOpen>
      <DrawerTrigger render={<Button />}>Filter replays</DrawerTrigger>
      <DrawerContent>
        <DrawerTitle>Filter replays</DrawerTitle>
        <p>Source, host and tags</p>
        <DrawerClose render={<Button />}>Done</DrawerClose>
      </DrawerContent>
    </Drawer>
  ),
};
export const TooltipOpen: Story = {
  render: () => (
    <Tooltip defaultOpen>
      <TooltipTrigger render={<Button />}>Copy link</TooltipTrigger>
      <TooltipContent>Copy a link at the current playhead</TooltipContent>
    </Tooltip>
  ),
};
