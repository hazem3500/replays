import { use } from 'react';
import { PluginContexts, usePluginSnapshot } from '../plugins/PluginUi.tsx';
import { contributionOwner, type ExportFormatDefinition, type ReplayExportFile } from '../plugins/contributions.ts';
import type { ViewerPluginContext } from '../plugins/api.ts';
import { resolveSlot } from '../plugins/registry.ts';

export interface PluginExportOption {
  key: string;
  label: string;
  run: () => void;
}

function download(file: ReplayExportFile): void {
  if (typeof file.name !== 'string' || !file.name.trim()) throw new Error('an export needs a filename');
  if (typeof file.data !== 'string' && !(file.data instanceof Blob)) throw new Error('an export needs text or a Blob');
  const blob = new Blob([file.data], { type: file.mime ?? (file.data instanceof Blob ? file.data.type : 'application/octet-stream') });
  if (blob.size > 25 * 1024 * 1024) throw new Error('an export must be at most 25 MiB');
  const name = Array.from(file.name, (char) => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char))
    .join('')
    .slice(0, 150);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  try {
    anchor.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/** A core group and host formats share order/hide policy; nothing runs until a person invokes an option. */
export function usePluginExports(): readonly (PluginExportOption | 'core')[] {
  usePluginSnapshot();
  const contextFor = use(PluginContexts);
  const base = contextFor?.('');
  const items = resolveSlot<ViewerPluginContext | undefined, ExportFormatDefinition | null>(
    'export.formats',
    [{ id: 'core:video', order: 100, render: () => null }],
    base,
  );
  const options: (PluginExportOption | 'core')[] = [];
  for (const item of items) {
    if (item.id === 'core:video') {
      options.push('core');
      continue;
    }
    if (!contextFor) continue;
    const context = contextFor(contributionOwner(item.id));
    let definition: ExportFormatDefinition | null;
    try {
      definition = item.render(context);
      if (!definition || (definition.when && !definition.when(context))) continue;
    } catch {
      continue;
    }
    options.push({
      key: item.id,
      label: definition.label,
      run: () => {
        void Promise.resolve()
          .then(() => definition.run(context))
          .then((file) => {
            if (file) download(file);
          })
          .catch(() => context.notify('The export could not be created'));
      },
    });
  }
  return options;
}
