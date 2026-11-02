import { resolveSlot } from '../../plugins/registry.ts';
import type { SlotDescriptor } from '../../plugins/slots.ts';
import { ms } from '../../../shared/diagnostics/detect.ts';
import type { Verdict, VitalId } from '../../../shared/diagnostics/budgets.ts';
import type { Vital } from './budgets.ts';

export const VITALS_SLOT = 'performance.vitals';

export interface VitalsContext {
  vitals: readonly Vital[];
  active: VitalId | undefined;
  onPick: (vital: Vital) => void;
}

/** One tile. A host adds a business metric by registering a descriptor that returns this. */
export interface VitalTile {
  label: string;
  /** What the abbreviation means, for the tooltip and the accessible name. */
  description: string;
  value?: string;
  verdict?: Verdict;
  /** Shown instead of a value: "Not captured", "None". */
  missing?: string;
  vital?: Vital;
}

export type VitalDescriptor = SlotDescriptor<VitalsContext, VitalTile>;

export const VERDICT_WORD: Readonly<Record<Verdict, string>> = { good: 'Good', 'needs-improvement': 'Needs work', poor: 'Poor' };

const STRINGS = {
  region: 'Performance summary',
  notCaptured: 'Not captured',
  none: 'None',
  tiles: {
    lcp: ['LCP', 'Largest contentful paint: when the main content showed up'],
    fcp: ['FCP', 'First contentful paint: when the page stopped being blank'],
    interaction: ['Worst interaction', 'The slowest response to input (an INP-style measure)'],
    'long-task': ['Longest task', 'The longest single main-thread task'],
    tbt: ['Blocking time', 'Total blocking time: main-thread time over 50 ms per task, summed'],
  } satisfies Record<VitalId, readonly [string, string]>,
};

function builtin(id: VitalId, order: number): VitalDescriptor {
  return {
    id: `core:${id}`,
    order,
    render: ({ vitals }) => {
      const vital = vitals.find((item) => item.id === id);
      const [label, description] = STRINGS.tiles[id];
      if (!vital || vital.value === undefined)
        return { label, description, missing: vital?.missing === 'none' ? STRINGS.none : STRINGS.notCaptured, ...(vital ? { vital } : {}) };
      return { label, description, value: ms(vital.value), ...(vital.verdict ? { verdict: vital.verdict } : {}), vital };
    },
  };
}

export const BUILTIN_VITALS: readonly VitalDescriptor[] = [
  builtin('lcp', 100),
  builtin('fcp', 200),
  builtin('interaction', 300),
  builtin('long-task', 400),
  builtin('tbt', 500),
];

/** "What's wrong" first: each tile judges one number against its budget; a click filters the table to its events. */
export function VitalsStrip(context: VitalsContext) {
  const tiles = resolveSlot<VitalsContext, VitalTile>(VITALS_SLOT, BUILTIN_VITALS, context);
  return (
    <div className="vitals" role="group" aria-label={STRINGS.region} data-slot={VITALS_SLOT}>
      {tiles.map((descriptor) => {
        const tile = descriptor.render(context);
        const pickable = Boolean(tile.vital?.worst);
        return (
          <button
            key={descriptor.id}
            type="button"
            className="vital"
            data-slot-item={descriptor.id}
            data-verdict={tile.verdict}
            data-missing={tile.missing ? '' : undefined}
            aria-pressed={pickable ? context.active === tile.vital?.id : undefined}
            disabled={!pickable}
            title={tile.description}
            onClick={() => tile.vital && context.onPick(tile.vital)}
          >
            <span className="vital-label">{tile.label}</span>
            <span className="vital-value">{tile.value ?? tile.missing}</span>
            {tile.verdict ? (
              <span className="vital-verdict">
                <span className="vital-dot" aria-hidden="true" />
                {VERDICT_WORD[tile.verdict]}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
