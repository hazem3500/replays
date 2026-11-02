// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DeleteReplayDialog, deleteReplayCopy } from '../src/client/components/delete-replay-dialog.tsx';
import { Button } from '../src/client/components/ui/button.tsx';
import { Dialog, DialogContent, DialogTitle } from '../src/client/components/ui/dialog.tsx';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(element: ReturnType<typeof createElement>) {
  await act(async () => root.render(element));
}

describe('deleteReplayCopy', () => {
  it('says the delete is permanent without a Trash', () => {
    expect(deleteReplayCopy('Checkout fails')).toEqual({
      title: 'Delete “Checkout fails”?',
      body: 'It’s removed for everyone. This can’t be undone.',
    });
  });

  it('names the Trash window once deletes are restorable', () => {
    expect(deleteReplayCopy('Checkout fails', 30).body).toBe('It’s removed for everyone. You can restore it from Trash for 30 days.');
  });
});

describe('DeleteReplayDialog', () => {
  it('is an alert dialog with the title, the copy and Cancel before a solid Delete', async () => {
    await render(createElement(DeleteReplayDialog, { title: 'Checkout fails', open: true, onDelete: () => {} }));
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.querySelector('[data-slot="dialog-title"]')!.textContent).toBe('Delete “Checkout fails”?');
    expect(dialog!.querySelector('[data-slot="dialog-description"]')!.textContent).toBe('It’s removed for everyone. This can’t be undone.');
    // why: a confirmation has no close button; Cancel (and Esc) is the way out.
    expect(dialog!.querySelector('[aria-label="Close"], .sr-only')).toBeNull();
    const actions = [...dialog!.querySelectorAll('[data-slot="dialog-footer"] > button')];
    expect(actions.map((action) => action.textContent)).toEqual(['Cancel', 'Delete']);
    expect(actions[1]!.className).toContain('bg-(color:--danger-solid)');
  });

  it('runs onDelete and closes when Delete is pressed', async () => {
    const onDelete = vi.fn<() => void>();
    const onOpenChange = vi.fn<(open: boolean) => void>();
    await render(createElement(DeleteReplayDialog, { title: 'Checkout fails', open: true, onOpenChange, onDelete }));
    const deleteButton = [...document.querySelectorAll('[data-slot="dialog-footer"] > button')].find((button) => button.textContent === 'Delete');
    await act(async () => (deleteButton as HTMLElement).click());
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });

  it('opens from its trigger', async () => {
    await render(
      createElement(DeleteReplayDialog, { title: 'Checkout fails', trigger: createElement(Button, null, 'Delete replay'), onDelete: () => {} }),
    );
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await act(async () => (host.querySelector('button') as HTMLElement).click());
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  });
});

describe('DialogContent', () => {
  it('keeps its close button by default and makes room for it beside the title', async () => {
    await render(createElement(Dialog, { open: true }, createElement(DialogContent, null, createElement(DialogTitle, null, 'Upload a replay'))));
    const popup = document.querySelector('[data-slot="dialog-content"]')!;
    expect(popup.querySelector('button')!.textContent).toBe('Close');
    expect(popup.className).toContain('[&_[data-slot=dialog-title]]:pe-');
  });

  it('lets callers drop the close button and replace the padding', async () => {
    await render(
      createElement(
        Dialog,
        { open: true },
        createElement(DialogContent, { showCloseButton: false, className: 'p-0' }, createElement(DialogTitle, null, 'Keyboard shortcuts')),
      ),
    );
    const popup = document.querySelector('[data-slot="dialog-content"]')!;
    expect(popup.querySelector('button')).toBeNull();
    expect(popup.className.split(' ')).toContain('p-0');
    expect(popup.className).not.toContain('p-(--dialog-pad)');
  });
});
