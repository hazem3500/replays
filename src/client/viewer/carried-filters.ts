import { createContext, use, useState } from 'react';

import type { LevelFilter } from './console/model.ts';
import type { NetworkFilter } from './network/model.ts';

/** The inspector filters a suite keeps while the person moves between its runs. */
export interface CarriedFilterValues {
  network: NetworkFilter;
  consoleLevel: LevelFilter;
  consoleText: string;
}

export interface FilterCarry {
  read: <K extends keyof CarriedFilterValues>(key: K) => CarriedFilterValues[K] | undefined;
  write: <K extends keyof CarriedFilterValues>(key: K, value: CarriedFilterValues[K]) => void;
}

/** One suite visit's filters; a run's panels start from them and write back every change. */
export function createFilterCarry(): FilterCarry {
  const values: Partial<CarriedFilterValues> = {};
  return {
    read: (key) => values[key],
    write: (key, value) => {
      values[key] = value;
    },
  };
}

const same = <T>(value: T): T => value;

/** Absent outside a suite: a lone replay's filters live and end with its panels. */
export const CarriedFilters = createContext<FilterCarry | undefined>(undefined);

/**
 * A panel filter that outlives the run (a suite run swap remounts the viewer). `carry` picks what the next run starts
 * from (the Network time range belongs to one recording, so it is not carried).
 */
export function useCarriedFilter<K extends keyof CarriedFilterValues>(
  key: K,
  initial: CarriedFilterValues[K],
  carry: (value: CarriedFilterValues[K]) => CarriedFilterValues[K] = same,
) {
  const store = use(CarriedFilters);
  const [value, setValue] = useState(() => store?.read(key) ?? initial);
  const update = (next: CarriedFilterValues[K]) => {
    setValue(next);
    store?.write(key, carry(next));
  };
  return [value, update] as const;
}
