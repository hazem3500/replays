import type { MouseEvent } from 'react';

/**
 * For the docked composer's own buttons: a press leaves focus where it was. Focus decides whether the composer is
 * expanded, and a box that grows or shrinks under the pointer between press and release swallows the click.
 */
export const keepFocus = (event: MouseEvent) => event.preventDefault();
