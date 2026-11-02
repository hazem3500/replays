import { copyText } from '../../clipboard.ts';
import { resolveSlot } from '../../plugins/registry.ts';
import type { SlotDescriptor } from '../../plugins/slots.ts';
import { notify } from '../../toast.ts';
import { curlCommand, type NetworkRow } from './model.ts';

export const NETWORK_ROW_ACTIONS_SLOT = 'inspector.network.row.actions';

export interface NetworkRowActionContext {
  row: NetworkRow;
}

/** A row's overflow menu item; a host adds "Open in tracing" the same way. */
export interface NetworkRowAction {
  label: string;
  run(): void | Promise<void>;
}

export type NetworkRowActionDescriptor = SlotDescriptor<NetworkRowActionContext, NetworkRowAction>;

const STRINGS = {
  copyUrl: 'Copy URL',
  copyCurl: 'Copy as cURL',
  copied: (what: string) => `Copied ${what}`,
  failed: 'Could not copy to the clipboard',
};

const copy = async (text: string, what: string) => notify((await copyText(text)) ? STRINGS.copied(what) : STRINGS.failed);

export const BUILTIN_ROW_ACTIONS: readonly NetworkRowActionDescriptor[] = [
  { id: 'core:copy-url', order: 100, render: ({ row }) => ({ label: STRINGS.copyUrl, run: () => copy(row.entry.url, 'URL') }) },
  {
    id: 'core:copy-curl',
    order: 200,
    render: ({ row }) => ({ label: STRINGS.copyCurl, run: () => copy(curlCommand(row.entry), 'cURL') }),
  },
];

export function resolveRowActions(row: NetworkRow) {
  const context = { row };
  return resolveSlot<NetworkRowActionContext, NetworkRowAction>(NETWORK_ROW_ACTIONS_SLOT, BUILTIN_ROW_ACTIONS, context).map(
    (descriptor) => ({ id: descriptor.id, action: descriptor.render(context) }),
  );
}
