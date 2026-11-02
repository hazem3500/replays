import { PlusIcon } from 'lucide-react';
import { useState } from 'react';

import { IconButton } from '@/components/icon-button.tsx';
import { MOBILE_QUERY, useMediaQuery } from '../../media.ts';
import { plural } from '../../plural.ts';
import { indexReturnHref } from '../../route.ts';
import { AddReplays } from './AddReplays.tsx';
import { LayoutSwitch } from './LayoutSwitch.tsx';
import { meetingHref } from './meeting-href.ts';
import { MeetingRoom } from './MeetingRoom.tsx';
import { MAX_TILES, type MeetingSearch } from './url.ts';
import { layoutOf, withLayout } from './view-state.ts';

export const MEETING_STRINGS = {
  title: (count: number) => plural(count, 'recording'),
  prefix: 'Compare',
  add: 'Add recordings',
} as const;

const replaceUrl = (search: MeetingSearch) => history.replaceState(history.state, '', meetingHref(search) + location.hash);

/**
 * `/compare`: an ad-hoc comparison of recordings that are not one suite (a suite compares its own runs in place).
 * The arrangement lives in the URL, so a copied link opens the same view.
 */
export function MeetingWorkspace({
  search: initial,
  onSearchChange = replaceUrl,
}: {
  search: MeetingSearch;
  onSearchChange?(next: MeetingSearch): void;
}) {
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [search, setSearch] = useState(initial);
  const [adding, setAdding] = useState(false);
  const change = (next: MeetingSearch) => {
    setSearch(next);
    onSearchChange(next);
  };
  const ids = search.ids ?? [];

  return (
    <>
      <MeetingRoom
        search={search}
        onSearchChange={change}
        title={MEETING_STRINGS.title(ids.length)}
        prefix={MEETING_STRINGS.prefix}
        backHref={indexReturnHref()}
        shareHref={meetingHref}
        mobile={mobile}
        actions={
          mobile ? null : (
            <LayoutSwitch
              compact
              value={layoutOf(search)}
              options={['grid', 'spotlight']}
              onChange={(layout) => change(withLayout(search, layout === 'spotlight' ? 'spotlight' : 'grid', ids))}
            />
          )
        }
        trailingActions={
          <IconButton label={MEETING_STRINGS.add} disabled={ids.length >= MAX_TILES} onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden="true" />
          </IconButton>
        }
      />
      <AddReplays
        open={adding}
        onOpenChange={setAdding}
        present={ids}
        onAdd={(added) => change({ ...search, ids: [...ids, ...added.filter((id) => !ids.includes(id))].slice(0, MAX_TILES) })}
      />
    </>
  );
}
