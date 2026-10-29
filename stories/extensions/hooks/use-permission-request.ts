import { useEffect, useState } from 'react';
import { permissions, type PluginRef } from '../../../src/client/malleable/broker.ts';

const plugin: PluginRef = {
  id: 'storybook-permission',
  source: 'fixture-only',
  log: () => {},
  manifest: {
    format: 'replays-user-plugin/1',
    id: 'storybook-permission',
    name: 'Bug report',
    permissions: ['comments:write'],
    contributes: {},
  },
};

/** Asks the real broker for a decision and reports it; the write it would allow never happens. */
export function usePermissionRequest(preview: string) {
  const [decision, setDecision] = useState('Awaiting your decision');
  useEffect(() => {
    let live = true;
    // why: a fresh source invalidates consent granted to the same plugin in an earlier story.
    const fixture = { ...plugin, source: crypto.randomUUID() };
    void permissions.request(fixture, 'comments:write', 'Add a bug report comment at 7.2 seconds.', preview).then((allowed) => {
      if (live) setDecision(allowed ? 'Allowed for this fixture; no comment was written.' : 'Denied; no comment was written.');
    });
    return () => {
      live = false;
      permissions.drop(plugin.id);
    };
  }, [preview]);
  return decision;
}
