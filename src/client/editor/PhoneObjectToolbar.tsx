import { CheckIcon, CopyIcon, FastForwardIcon, ScissorsIcon, SlidersHorizontalIcon, SplitIcon, Trash2Icon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { cssVars } from '../lib/css-vars.ts';
import { EFFECT_KINDS, type EffectKind, type Selection } from './state.ts';

/** What a selected object can do from the phone toolbar; the editor supplies each. */
export interface PhoneObjectActions {
  /** Opens the object's settings in the sheet. */
  adjust: () => void;
  split: (kind: EffectKind, id: string) => void;
  duplicate: (kind: EffectKind, id: string) => void;
  remove: () => void;
  /** Cuts a second at the playhead (or the selected range). */
  cut: () => void;
  speedUp: () => void;
  done: () => void;
}

interface Item {
  label: string;
  icon: ReactNode;
  run: () => void;
  testId: string;
}

/** One string per selectable object (its kind and id), so a sheet can stay with the object it was opened for. */
export function selectionKey(selection: Selection) {
  if (!selection) return;
  if (selection.kind === 'trim' || selection.kind === 'range') return selection.kind;
  return `${selection.kind}:${selection.id}`;
}

const isEffect = (kind: string): kind is EffectKind => (EFFECT_KINDS as readonly string[]).includes(kind);

function itemsFor(selection: NonNullable<Selection>, actions: PhoneObjectActions): Item[] {
  const adjust: Item = { label: 'Adjust', icon: <SlidersHorizontalIcon aria-hidden="true" />, run: actions.adjust, testId: 'phone-adjust' };
  const remove: Item = { label: 'Delete', icon: <Trash2Icon aria-hidden="true" />, run: actions.remove, testId: 'phone-delete' };
  const cut: Item = { label: 'Cut', icon: <ScissorsIcon aria-hidden="true" />, run: actions.cut, testId: 'phone-cut' };
  if (selection.kind === 'trim')
    return [
      { ...adjust, label: 'Trim' },
      cut,
      { label: 'Speed up', icon: <FastForwardIcon aria-hidden="true" />, run: actions.speedUp, testId: 'phone-speed' },
    ];
  if (selection.kind === 'range') return [adjust, cut];
  if (selection.kind === 'cut' || selection.kind === 'highlight') return [adjust, remove];
  const { kind, id } = selection;
  if (!isEffect(kind)) return [adjust];
  return [
    adjust,
    { label: 'Split', icon: <SplitIcon aria-hidden="true" />, run: () => actions.split(kind, id), testId: 'phone-split' },
    { label: 'Duplicate', icon: <CopyIcon aria-hidden="true" />, run: () => actions.duplicate(kind, id), testId: 'phone-duplicate' },
    remove,
  ];
}

/**
 * The phone toolbar while an object is selected (the mobile video-editor pattern): that object's actions in place
 * of the add tools, with Done to deselect and bring them back.
 */
export function PhoneObjectToolbar({ selection, actions }: { selection: NonNullable<Selection>; actions: PhoneObjectActions }) {
  const items = itemsFor(selection, actions);
  return (
    <div
      className="editor-add-toolbar phone-object-toolbar"
      role="group"
      aria-label="Selected object"
      style={cssVars({ '--count': items.length + 1 })}
      data-testid="phone-object-toolbar"
    >
      {items.map((item) => (
        <Button key={item.testId} variant="ghost" onClick={item.run} data-testid={item.testId}>
          {item.icon}
          {item.label}
        </Button>
      ))}
      <Button variant="ghost" onClick={actions.done} data-testid="phone-done">
        <CheckIcon aria-hidden="true" />
        Done
      </Button>
    </div>
  );
}
