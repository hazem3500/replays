import { Calligraph } from 'calligraph';

import { useMediaQuery } from './media.ts';

/** Character-level caption changes; the parent keeps this component mounted while its text changes. */
export function CaptionMorph({ text }: { text: string }) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  return (
    <span className="caption-calligraph" data-caption-morph="" data-motion={reducedMotion ? 'reduced' : 'full'}>
      {reducedMotion ? (
        text
      ) : (
        <Calligraph data-calligraph="" animation="snappy" drift={{ x: 6, y: 0 }} stagger={0} autoSize={false}>
          {text}
        </Calligraph>
      )}
    </span>
  );
}
