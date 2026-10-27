import { WorkspacePluginNotices } from './WorkspacePluginNotices.tsx';
import { useEffect } from 'react';

import type { ReplayBundle } from '../../shared/replay.ts';
import type { ReplayController } from '../player.ts';
import { usePluginContext } from '../plugins/PluginUi.tsx';
import { KeepDialog } from './KeepDialog.tsx';
import { manager } from './manager.ts';
import { PermissionPrompt } from './PermissionPrompt.tsx';
import { Workshop } from './Workshop.tsx';
import './malleable.css';

/** Mounted by the viewer when beta.malleable is on: tells the manager which replay is open and draws the workshop and prompts. */
export default function MalleableHost({ bundle, player }: { bundle: ReplayBundle; player: ReplayController }) {
  const context = usePluginContext(bundle, player);
  useEffect(() => {
    manager.setViewer(context);
    return () => manager.setViewer(undefined);
  }, [context]);
  return (
    <>
      <WorkspacePluginNotices />
      <Workshop />
      <KeepDialog />
      <PermissionPrompt />
    </>
  );
}
