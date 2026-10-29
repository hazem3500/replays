import { Children, isValidElement, type ReactNode } from 'react';

import { resolveSlot } from '../plugins/registry.ts';
import type { SlotDescriptor } from '../plugins/slots.ts';

export const CONTEXT_SECTIONS_SLOT = 'viewer.context.sections';

const UNESCAPED: Record<string, string> = { '=0': '=', '=2': ':' };

/**
 * Plugin sections are keyed by their slot id; React prefixes the keys it collects with `.$` and escapes `=` and `:` in
 * them (`=0`, `=2`), so the id is read back from that form.
 */
function slotId(node: ReactNode) {
  if (!isValidElement(node) || node.key === null) return '';
  return node.key.replace(/^\.\$/, '').replace(/=[02]/g, (escaped) => UNESCAPED[escaped] ?? escaped);
}

/**
 * The Context tab's blocks as one ordered `viewer.context.sections` list: the built-ins (`core:*`, each marked with its
 * slot id) and the plugin sections the plugin renderer drew, placed where the slot's order puts them; hidden ids drop
 * out. Plugin nodes the registry does not know (late registrations) follow at the end.
 */
export function contextSections<C>(builtins: readonly SlotDescriptor<C, ReactNode>[], context: C, plugins: ReactNode): ReactNode {
  const drawn = new Map(Children.toArray(plugins).map((node) => [slotId(node), node]));
  const placed = new Set<string>();
  const ordered = resolveSlot(CONTEXT_SECTIONS_SLOT, builtins, context).map((descriptor) => {
    if (descriptor.id.startsWith('core:'))
      return (
        <div key={descriptor.id} className="ctx-slot" data-slot-item={descriptor.id}>
          {descriptor.render(context)}
        </div>
      );
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
