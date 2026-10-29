import type { ReplayBundle } from '../../shared/replay.ts';
import { usePlayer } from '../player.ts';
import { vitalsOf } from '../viewer/performance/model.ts';
import { VitalsBar } from '../viewer/performance/VitalsBar.tsx';

/** The Performance view's headline: the vitals verdicts; a tile seeks to its moment and opens the Performance tab. */
export function VitalsTile({ bundle, onOpen }: { bundle: ReplayBundle; onOpen: () => void }) {
  const player = usePlayer();
  return (
    <div className="headline-tile headline-vitals" data-testid="headline-vitals">
      <VitalsBar
        vitals={vitalsOf(bundle)}
        peers={[]}
        onPick={(vital) => {
          const at = vital.moment?.at ?? vital.at;
          if (at !== undefined) player.seek(at);
          onOpen();
        }}
      />
    </div>
  );
}
