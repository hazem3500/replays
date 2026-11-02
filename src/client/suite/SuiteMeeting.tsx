import type { ReactNode } from 'react';

import type { MeetingClock } from '../comparison/meeting/clock.ts';
import { LayoutSwitch } from '../comparison/meeting/LayoutSwitch.tsx';
import { MeetingRoom, type RoomRuns } from '../comparison/meeting/MeetingRoom.tsx';
import type { MeetingSearch } from '../comparison/meeting/url.ts';
import { layoutOf, type MeetingLayout } from '../comparison/meeting/view-state.ts';
import { plural } from '../plural.ts';
import { replayInSuiteHref } from '../route.ts';
import { suiteViewHref } from './suite-layout.ts';

/**
 * A suite's runs in the meeting view, in place of the single viewer. Desktop switches layouts from the sidebar;
 * phones have no sidebar, so Single · Grid sits in the top bar (a spotlight needs the room a phone lacks).
 */
export function SuiteMeeting({
  suiteId,
  title,
  runs,
  meeting,
  onMeetingChange,
  clock,
  narrow,
  onLayout,
  backHref,
  menu,
}: {
  suiteId: string;
  title: string;
  runs: RoomRuns;
  meeting: MeetingSearch;
  onMeetingChange(next: MeetingSearch): void;
  clock: MeetingClock;
  narrow: boolean;
  onLayout(layout: MeetingLayout): void;
  backHref: string;
  /** Phones: the suite's own "More" entries (Keep). */
  menu?: ReactNode;
}) {
  return (
    <MeetingRoom
      search={meeting}
      onSearchChange={onMeetingChange}
      runs={runs}
      clock={clock}
      title={title}
      prefix={plural(runs.ids.length, 'run')}
      backHref={backHref}
      mobile={narrow}
      recordingHref={(run, seconds) => `${replayInSuiteHref(run, suiteId)}?t=${seconds}`}
      shareHref={(next) => suiteViewHref(location.pathname, { layout: layoutOf(next), meeting: next }, location.search)}
      {...(narrow ? { actions: <LayoutSwitch compact value={layoutOf(meeting)} options={['single', 'grid']} onChange={onLayout} /> } : {})}
      {...(menu ? { menu } : {})}
    />
  );
}
