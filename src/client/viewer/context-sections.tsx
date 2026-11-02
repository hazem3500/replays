import { Children, isValidElement, type ReactNode } from 'react';

import { resolveSlot } from '../plugins/registry.ts';
import type { SlotDescriptor } from '../plugins/slots.ts';

export const CONTEXT_SECTIONS_SLOT = 'viewer.context.sections';

/** React prefixes keys it collects with `.$`; plugin sections are keyed by their slot id. */
const slotId = (node: ReactNode) => (isValidElement(node) && node.key !== null ? String(node.key).replace(/^\.\$/, '') : '');

/**
 * The Context tab's blocks as one ordered `viewer.context.sections` list: the built-ins (`core:*`, rendered here, each
 * marked with its slot id) and the plugin sections the existing renderer drew (PluginSlots), placed where the slot's
 * order puts them; hidden ids drop out. Plugin nodes the registry does not know (tests, late registrations) follow.
 */
export function contextSections<C>(builtins: readonly SlotDescriptor<C, ReactNode>[], context: C, plugins: ReactNode): ReactNode {
  const drawn = new Map(Children.toArray(plugins).map((node) => [slotId(node), node]));
  const placed = new Set<string>();
  const ordered = resolveSlot(CONTEXT_SECTIONS_SLOT, builtins, context).map((descriptor) => {
    if (descriptor.id.startsWith('core:')) {
      return (
        <div key={descriptor.id} className="ctx-slot" data-slot-item={descriptor.id}>
          {descriptor.render(context)}
        </div>
      );
    }
    const node = drawn.get(descriptor.id);
    if (node === undefined) return null;
    placed.add(descriptor.id);
    return node;
  });
  return (
    <>
      {ordered}
      {[...drawn].filter(([id]) => !placed.has(id)).map(([, node]) => node)}
    </>
  );
}
