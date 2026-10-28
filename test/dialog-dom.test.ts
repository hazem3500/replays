// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Dialog, DialogContent, DialogTitle } from '../src/client/components/ui/dialog.tsx';
import { settle } from './settle.ts';

let host: HTMLDivElement;
let root: Root;

function popup() {
  const element = document.querySelector('[data-slot="dialog-content"]');
  if (!element) throw new Error('expected the dialog to be open');
  return element;
}

describe('DialogContent', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await settle(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('keeps its close button by default and makes room for it beside the title', async () => {
    const title = createElement(DialogTitle, null, 'Upload a replay');
    await settle(() => root.render(createElement(Dialog, { open: true }, createElement(DialogContent, null, title))));
    expect(popup().querySelector('button')?.textContent).toBe('Close');
    expect(popup().className).toContain('[&_[data-slot=dialog-title]]:pe-');
  });

  it('lets callers drop the close button and replace the padding', async () => {
    const content = createElement(
      DialogContent,
      { showCloseButton: false, className: 'p-0' },
      createElement(DialogTitle, null, 'Keyboard shortcuts'),
    );
    await settle(() => root.render(createElement(Dialog, { open: true }, content)));
    expect(popup().querySelector('button')).toBeNull();
    expect(popup().className.split(' ')).toContain('p-0');
    expect(popup().className).not.toContain('p-(--dialog-pad)');
  });
});
