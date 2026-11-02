import { ChartNoAxesGanttIcon, SearchIcon, XIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';

import type { InspectorFilter } from '../../data/inspector.ts';
import type { RequestType, StatusClass } from './model.ts';

export const STATUS_CHIPS = [
  { id: 'all', label: 'All', statuses: [] },
  { id: 'failed', label: 'Failed', statuses: ['client-error', 'server-error', 'failed'] },
  { id: '4xx', label: '4xx', statuses: ['client-error'] },
  { id: '5xx', label: '5xx', statuses: ['server-error'] },
] as const satisfies ReadonlyArray<{ id: string; label: string; statuses: readonly StatusClass[] }>;

export const TYPE_CHIPS = [
  { id: 'all', label: 'All', title: 'All types', types: [] },
  { id: 'fetch', label: 'Fetch/XHR', title: 'Fetch and XHR', types: ['fetch', 'xhr'] },
  { id: 'document', label: 'Doc', title: 'Documents', types: ['document'] },
  { id: 'script', label: 'JS', title: 'Scripts', types: ['script'] },
  { id: 'stylesheet', label: 'CSS', title: 'Stylesheets', types: ['stylesheet'] },
  { id: 'image', label: 'Img', title: 'Images', types: ['image'] },
  { id: 'font', label: 'Font', title: 'Fonts', types: ['font'] },
  { id: 'other', label: 'Other', title: 'Other types', types: ['other'] },
] as const satisfies ReadonlyArray<{ id: string; label: string; title: string; types: readonly RequestType[] }>;

export type StatusChip = (typeof STATUS_CHIPS)[number]['id'];
export type TypeChip = (typeof TYPE_CHIPS)[number]['id'];

export interface NetworkToolbarState {
  text: string;
  status: StatusChip;
  type: TypeChip;
}

export const EMPTY_TOOLBAR: NetworkToolbarState = { text: '', status: 'all', type: 'all' };

/** The toolbar's state as the agreed filter shape (`network` part); empty lists mean "any". */
export function toolbarFilter(state: NetworkToolbarState): Pick<InspectorFilter, 'statuses' | 'types'> {
  const statuses = STATUS_CHIPS.find((chip) => chip.id === state.status)?.statuses ?? [];
  const types = TYPE_CHIPS.find((chip) => chip.id === state.type)?.types ?? [];
  return { ...(statuses.length ? { statuses: [...statuses] } : {}), ...(types.length ? { types: [...types] } : {}) };
}

const STRINGS = {
  search: 'Filter requests',
  placeholder: 'Filter URL, method, status',
  clear: 'Clear filter text',
  status: 'Request status',
  type: 'Request type',
  timing: 'Timing',
  timingLabel: 'Show the Timing column',
};

/** Keys typed here are the toolbar's, not the player's (space, arrows). */
const keepKeys = (event: KeyboardEvent<HTMLElement>) => {
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) event.stopPropagation();
};

export function NetworkToolbar({
  state,
  onChange,
  showTiming,
  onTimingChange,
  timingAvailable,
}: {
  state: NetworkToolbarState;
  onChange: (state: NetworkToolbarState) => void;
  showTiming: boolean;
  onTimingChange: (shown: boolean) => void;
  /** Phones have no Timing column. */
  timingAvailable: boolean;
}) {
  return (
    <div className="net-toolbar" data-slot="inspector.network.toolbar">
      <label className="net-search">
        <SearchIcon aria-hidden="true" />
        <span className="visually-hidden">{STRINGS.search}</span>
        <input
          type="search"
          placeholder={STRINGS.placeholder}
          value={state.text}
          data-testid="network-search"
          onChange={(event) => onChange({ ...state, text: event.target.value })}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape' && state.text) {
              event.preventDefault();
              onChange({ ...state, text: '' });
            }
          }}
        />
        {state.text ? (
          <button type="button" className="net-search-clear" aria-label={STRINGS.clear} onClick={() => onChange({ ...state, text: '' })}>
            <XIcon aria-hidden="true" />
          </button>
        ) : null}
      </label>
      <div className="net-chips" role="group" aria-label={STRINGS.status}>
        {STATUS_CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className="net-chip"
            data-tone={chip.id === 'all' ? undefined : 'danger'}
            aria-pressed={state.status === chip.id}
            onKeyDown={keepKeys}
            onClick={() => onChange({ ...state, status: chip.id })}
          >
            {chip.label}
          </button>
        ))}
      </div>
      <label className="net-type-select">
        <span className="visually-hidden">{STRINGS.type}</span>
        <select value={state.type} onChange={(event) => onChange({ ...state, type: event.target.value as TypeChip })} onKeyDown={keepKeys}>
          {TYPE_CHIPS.map((chip) => (
            <option key={chip.id} value={chip.id}>
              {chip.id === 'all' ? chip.title : chip.label}
            </option>
          ))}
        </select>
      </label>
      <div className="net-segments" role="group" aria-label={STRINGS.type}>
        {TYPE_CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className="net-segment"
            title={chip.title}
            aria-pressed={state.type === chip.id}
            onKeyDown={keepKeys}
            onClick={() => onChange({ ...state, type: chip.id })}
          >
            {chip.label}
          </button>
        ))}
      </div>
      {timingAvailable ? (
        <button
          type="button"
          className="net-timing-toggle"
          aria-pressed={showTiming}
          aria-label={STRINGS.timingLabel}
          onClick={() => onTimingChange(!showTiming)}
          onKeyDown={keepKeys}
        >
          <ChartNoAxesGanttIcon aria-hidden="true" />
          <span>{STRINGS.timing}</span>
        </button>
      ) : null}
    </div>
  );
}
