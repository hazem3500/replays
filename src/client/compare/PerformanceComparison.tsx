import { COMPARE_METRICS, deltaLabel, metricDelta, metricLabel, type MetricValues, metricValues } from './performance-compare.ts';
import { type CompareTile, isLoaded } from './tiles.ts';

const PERFORMANCE_COMPARE_STRINGS = {
  region: 'Performance across the compared recordings',
  caption: (letter: string) => `Against ${letter}, the recording in focus`,
  recording: 'Recording',
  missing: 'Not captured',
  show: (letter: string, label: string) => `Inspect ${letter}: ${label}`,
} as const;

type Metric = (typeof COMPARE_METRICS)[number];

/**
 * Above the performance events: each compared recording's worst paint, task and interaction side by side, with
 * how far each is from the focused one. Choosing a row focuses that recording, so its events fill the list below.
 */
export function PerformanceComparison({
  tiles,
  focus,
  onFocus,
}: {
  tiles: readonly CompareTile[];
  focus: string;
  onFocus: (id: string) => void;
}) {
  const rows = tiles.filter(isLoaded).map((tile) => ({ tile, values: metricValues(tile.bundle) }));
  const baseline = rows.find((row) => row.tile.id === focus) ?? rows[0];
  const metrics = COMPARE_METRICS.filter((metric) => rows.some((row) => row.values[metric.id] !== undefined));
  if (rows.length < 2 || !baseline || !metrics.length) return null;

  return (
    <section className="ct-perf" aria-label={PERFORMANCE_COMPARE_STRINGS.region} data-testid="performance-comparison">
      <table>
        <caption>{PERFORMANCE_COMPARE_STRINGS.caption(baseline.tile.letter)}</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">{PERFORMANCE_COMPARE_STRINGS.recording}</span>
            </th>
            {metrics.map((metric) => (
              <th key={metric.id} scope="col">
                {metric.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ tile, values }) => (
            <MetricRow
              key={tile.id}
              tile={tile}
              values={values}
              baseline={tile === baseline.tile ? undefined : baseline.values}
              metrics={metrics}
              onFocus={onFocus}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function MetricRow({
  tile,
  values,
  baseline,
  metrics,
  onFocus,
}: {
  tile: CompareTile;
  values: MetricValues;
  /** The focused recording's values; absent on its own row. */
  baseline: MetricValues | undefined;
  metrics: readonly Metric[];
  onFocus: (id: string) => void;
}) {
  return (
    <tr data-focused={!baseline || undefined} data-tile={tile.colour}>
      <th scope="row">
        <button
          type="button"
          className="ct-perf-who"
          aria-label={PERFORMANCE_COMPARE_STRINGS.show(tile.letter, tile.label)}
          aria-pressed={!baseline}
          onClick={() => onFocus(tile.id)}
        >
          <span className="ct-chip" aria-hidden="true">
            {tile.letter}
          </span>
          <span className="ct-perf-name">{tile.label}</span>
        </button>
      </th>
      {metrics.map((metric) => {
        const value = values[metric.id];
        const delta = baseline ? metricDelta(value, baseline[metric.id]) : undefined;
        return (
          <td key={metric.id} data-missing={value === undefined || undefined}>
            <span className="ct-perf-value">{value === undefined ? PERFORMANCE_COMPARE_STRINGS.missing : metricLabel(value)}</span>
            {delta ? (
              <span className="ct-delta" data-tone={delta.tone}>
                {deltaLabel(delta)}
              </span>
            ) : null}
          </td>
        );
      })}
    </tr>
  );
}
