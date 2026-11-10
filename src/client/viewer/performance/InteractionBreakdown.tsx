import type { ReplayInteraction } from '../../../shared/replay.ts';
import { formatDuration } from '../network/model.ts';
import { BREAKDOWN_LABELS, BREAKDOWN_PARTS, interactionSentence } from './why.ts';

const STRINGS = {
  title: 'Where the time went',
  of: (total: string) => `of ${total} from input to the next paint`,
};

/**
 * One interaction as a bar of its three phases: input delay (the page was busy), processing (event handlers ran) and
 * presentation (until the next frame was painted), with the target in words. Renders in any row detail container.
 */
export function InteractionBreakdown({ interaction }: { interaction: ReplayInteraction }) {
  const total = interaction.inputDelay + interaction.processing + interaction.presentation;
  return (
    <section className="np-section pp-breakdown" aria-label={STRINGS.title} data-testid="interaction-breakdown">
      <h3>{STRINGS.title}</h3>
      <p className="pp-breakdown-target">{interactionSentence(interaction)}</p>
      <div
        className="pp-breakdown-bar"
        role="img"
        aria-label={BREAKDOWN_PARTS.map((part) => `${BREAKDOWN_LABELS[part]} ${formatDuration(interaction[part])}`).join(', ')}
      >
        {BREAKDOWN_PARTS.map((part) => (
          <span
            key={part}
            className="pp-breakdown-seg"
            data-part={part}
            style={{ flexGrow: Math.max(interaction[part], 0), flexBasis: 0 }}
          />
        ))}
      </div>
      <ul className="pp-breakdown-legend">
        {BREAKDOWN_PARTS.map((part) => (
          <li key={part}>
            <i className="pp-breakdown-swatch" data-part={part} aria-hidden="true" />
            <span>{BREAKDOWN_LABELS[part]}</span>
            <strong>{formatDuration(interaction[part])}</strong>
          </li>
        ))}
      </ul>
      <p className="np-aside pp-breakdown-total">{STRINGS.of(formatDuration(total))}</p>
    </section>
  );
}
