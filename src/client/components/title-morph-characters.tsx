import { Calligraph } from 'calligraph';

import { useTitleMorph } from '../hooks/use-title-morph.ts';

/** Character motion is loaded only by an active replay title. */
export function TitleMorphCharacters({ text, from }: { text: string; from?: string | undefined }) {
  const displayed = useTitleMorph(text, from);
  return (
    <Calligraph aria-hidden="true" animation="snappy" initial={false} autoSize={false} stagger={0} drift={{ x: 4, y: 0 }}>
      {displayed}
    </Calligraph>
  );
}
