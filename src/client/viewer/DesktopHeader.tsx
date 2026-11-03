import { type ComponentProps, type ReactNode, useRef, useState } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import type { ReplayBundle } from '../../shared/replay.ts';
import { editingEnabled } from '../config.ts';
import { Topbar, type TopbarMenuItem } from '../Topbar.tsx';
import { DownloadVideoButton } from './DownloadVideo.tsx';
import { ReplayInfoButton, type SuiteDetails } from './ReplayInfo.tsx';
import { actionMenuItems, ActionsBar, CopyLinkButton, EditButton } from './TopbarActions.tsx';

type HeaderProps = Omit<ComponentProps<typeof Topbar>, 'actions' | 'menuItems'> & {
  bundle: ReplayBundle;
  suite?: SuiteDetails | undefined;
  menuItems: TopbarMenuItem[];
  leadingActions?: ReactNode;
  pluginActions: ReactNode;
  hasEdits: boolean;
};

/** Layout, editing, sharing and download stay visible; recording details share More. */
export function DesktopHeader({ bundle, suite, menuItems, leadingActions, pluginActions, hasEdits, ...props }: HeaderProps) {
  const [details, setDetails] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const detailsItem: TopbarMenuItem = {
    label: 'Replay details',
    icon: <AnimatedIcon name="info" />,
    onSelect: () => setDetails(true),
    testId: 'replay-details',
  };
  return (
    <>
      <Topbar
        {...props}
        appearanceInMenu
        menuAnchor={menuAnchor}
        menuItems={[
          ...menuItems.filter((item) => item.testId === 'compare-with'),
          ...actionMenuItems({ 'core:info': [detailsItem] }),
          ...menuItems.filter((item) => item.testId !== 'compare-with'),
        ]}
        alwaysMenu
        actions={
          <ActionsBar
            actions={{
              'core:compare': leadingActions,
              'core:edit': editingEnabled() ? <EditButton id={bundle.meta.id} hasEdits={hasEdits} /> : null,
              'core:link': <CopyLinkButton suiteHref={suite?.href} />,
              'core:download': <DownloadVideoButton meta={bundle.meta} />,
            }}
            plugins={pluginActions}
          />
        }
      />
      <ReplayInfoButton bundle={bundle} suite={suite} open={details} onOpenChange={setDetails} anchor={menuAnchor} />
    </>
  );
}
