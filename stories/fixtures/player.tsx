import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { PlayerContext, ReplayController } from '../../src/client/player.ts';
import { ViewerContext, type ViewerActions, type InspectorTab } from '../../src/client/viewer/context.ts';
import type { ReplayBundle } from '../../src/shared/replay.ts';
import { replay } from './replays.ts';
const noop = () => {};
export function PlayerFixture({
  children,
  bundle = replay(),
  atEnd = true,
}: {
  children: ReactNode;
  bundle?: ReplayBundle;
  atEnd?: boolean;
}) {
  const [player] = useState(() => new ReplayController(bundle));
  const [, setTab] = useState<InspectorTab | 'steps'>('console');
  const [, setExpandedRequest] = useState<string>();
  const [captions, setCaptions] = useState(false);
  useEffect(() => {
    player.seek(atEnd ? player.duration : 0);
    return () => player.pause();
  }, [player, atEnd]);
  const value = useMemo<ViewerActions>(
    () => ({
      steps: bundle.steps,
      errors: [],
      setTab,
      setExpandedRequest,
      captions,
      switchCaptions: () => setCaptions((on) => !on),
      goToStep: (i) => player.seek(bundle.steps[i]?.at ?? 0),
      goToNextStep: noop,
      goToPreviousStep: noop,
      jumpToError: noop,
      goToNextError: noop,
      goToPreviousError: noop,
      copyLink: noop,
      switchFullscreen: noop,
      openShortcuts: noop,
      notify: noop,
    }),
    [bundle, player, captions],
  );
  return (
    <PlayerContext.Provider value={player}>
      <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>
    </PlayerContext.Provider>
  );
}
