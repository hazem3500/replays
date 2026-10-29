import { useEffect } from 'react';
import { viewerRegistry } from '../plugins/registry.ts';

/** Filter activity excludes values, query text and identity-linked handles. */
export function useIndexPluginEvents(search: string): void {
  useEffect(() => {
    const params = new URLSearchParams(search);
    const activeCount = [...params.keys()].filter(
      (key) => ['q', 'host', 'errors', 'source', 'tag', 'profile', 'kind', 'for'].includes(key) || /^x-[a-z0-9-]+$/.test(key),
    ).length;
    viewerRegistry.emitEvent({ type: 'index:filter', activeCount });
  }, [search]);
}
