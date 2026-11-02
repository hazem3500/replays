import { BotIcon, CircleAlertIcon, GlobeIcon, LayersIcon, SlidersHorizontalIcon, TagIcon, UserRoundIcon } from 'lucide-react';
import { Fragment, type KeyboardEvent, type ReactNode, useState } from 'react';

import '../filter-menu.css';

import {
  type Choice,
  type FilterState,
  filterStrings,
  handleAccepted,
  type LinkableHandle,
  type PluginFilter,
  pluginTestId,
  type ResolvedFilterRows,
  type SwitchFilter,
} from './model.ts';

/**
 * The handles For me also matches by ("GitHub username"), saved in this browser on Enter or blur.
 * A value that does not fit the handle's pattern is marked and not saved.
 */
function HandleFields({
  handles,
  linked,
  onSave,
}: {
  handles: readonly LinkableHandle[];
  linked: Readonly<Record<string, string>>;
  onSave: (id: string, value: string) => void;
}) {
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const save = (handle: LinkableHandle, raw: string) => {
    const value = raw.trim();
    const ok = handleAccepted(handle, value);
    setInvalid((current) => ({ ...current, [handle.id]: !ok }));
    if (ok && value !== (linked[handle.id] ?? '')) onSave(handle.id, value);
  };
  return (
    <div className="filter-handles">
      {handles.map((handle) => (
        <label key={handle.id} className="filter-handle">
          <span>{filterStrings.yourHandle(handle.label)}</span>
          <input
            className="filter-handle-input"
            data-testid={`for-me-handle-${handle.id}`}
            defaultValue={linked[handle.id] ?? ''}
            placeholder={handle.label}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalid[handle.id] || undefined}
            onBlur={(event) => save(handle, event.currentTarget.value)}
            // why: typing belongs to the field, not to the menu's typeahead and arrow keys (Escape still closes).
            onKeyDown={(event) => {
              if (event.key === 'Escape') return;
              event.stopPropagation();
              if (event.key === 'Enter') save(handle, event.currentTarget.value);
            }}
          />
        </label>
      ))}
    </div>
  );
}

function ForMeFields({ forMe, handles, linked, setLinked }: FilterState) {
  return forMe && handles?.length && setLinked ? <HandleFields handles={handles} linked={linked ?? {}} onSave={setLinked} /> : null;
}

/** Keys the menus use for their own navigation; everything else types into the field. */
function keepTyping(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key !== 'Escape' && event.key !== 'ArrowDown') event.stopPropagation();
}

/** A plugin `text` filter, applied on Enter or blur. Keyed by its value, so a change elsewhere resets the draft. */
function TextFilter({ filter, state }: { filter: PluginFilter; state: FilterState }) {
  const { param, label } = filter.definition;
  const value = state.filters.params?.[param] ?? '';
  const [draft, setDraft] = useState(value);
  const commit = () => {
    if (draft.trim() !== value) state.setParam(param, draft.trim() || undefined);
  };
  return (
    <label className="filter-row filter-text-row" data-filter-key={filter.key} data-active={value ? '' : undefined} data-testid={pluginTestId(filter)}>
      <span className="filter-row-label">{label}</span>
      <input
        className="filter-text-input"
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          keepTyping(event);
          if (event.key === 'Enter') commit();
        }}
        onBlur={commit}
      />
    </label>
  );
}

const CHOICE_ICONS: Record<string, typeof GlobeIcon> = { host: GlobeIcon, tag: TagIcon, source: BotIcon, kind: LayersIcon };
const SWITCH_ICONS: Record<SwitchFilter['icon'], typeof GlobeIcon> = { errors: CircleAlertIcon, 'for-me': UserRoundIcon, plugin: SlidersHorizontalIcon };

export function ChoiceIcon({ name }: { name: string }) {
  const Icon = CHOICE_ICONS[name] ?? SlidersHorizontalIcon;
  return <Icon className="filter-kind-icon" aria-hidden="true" />;
}

function SwitchRow({ filter }: { filter: SwitchFilter }) {
  const Icon = SWITCH_ICONS[filter.icon];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={filter.checked}
      className="filter-row filter-switch-row"
      data-filter-key={filter.key}
      data-active={filter.checked || undefined}
      data-testid={filter.testId}
      onClick={() => filter.onChange(!filter.checked)}
    >
      <Icon className="filter-kind-icon" aria-hidden="true" />
      <span className="filter-row-label">{filter.label}</span>
      <span className="filter-switch" aria-hidden="true" />
    </button>
  );
}

/** The rows in list order, a hairline between groups (people · facets · status). Choice rows differ per surface. */
export function FilterRows({
  rows,
  state,
  renderChoice,
}: {
  rows: ResolvedFilterRows;
  state: FilterState;
  renderChoice: (choice: Choice) => ReactNode;
}) {
  return (
    <div className="filter-list" data-slot="index.filters">
      {rows.map(({ id, row }, index) => (
        <Fragment key={id}>
          {index > 0 && rows[index - 1]!.row.group !== row.group ? <div className="filter-separator" role="presentation" /> : null}
          <div className="filter-list-item" data-slot-item={id}>
            {row.type === 'choice' ? (
              renderChoice(row.choice)
            ) : row.type === 'switch' ? (
              <SwitchRow filter={row.filter} />
            ) : (
              <TextFilter key={`${row.filter.key}=${state.filters.params?.[row.filter.definition.param] ?? ''}`} filter={row.filter} state={state} />
            )}
            {row.type === 'switch' && row.filter.key === 'for-me' ? <ForMeFields {...state} /> : null}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
