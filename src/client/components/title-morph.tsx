import { Calligraph } from 'calligraph';

import { useTitleHydrated, useTitleMorph } from '../hooks/use-title-morph.ts';
import { useMediaQuery } from '../media.ts';

/** Morphs a title without exposing outgoing characters to the heading or menu's accessible name. */
export function TitleMorph({ text, from }: { text: string; from?: string | undefined }) {
  const hydrated = useTitleHydrated();
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  return (
    <span data-title-morph="" data-motion={reduced ? 'reduced' : 'full'}>
      {hydrated && !reduced ? (
        <>
          <span className="visually-hidden">{text}</span>
          <MorphCharacters text={text} from={from} />
        </>
      ) : text}
    </span>
  );
}

function MorphCharacters({ text, from }: { text: string; from?: string | undefined }) {
  const displayed = useTitleMorph(text, from);
  return <Calligraph aria-hidden="true" animation="snappy" initial={false} autoSize={false} stagger={0} drift={{ x: 4, y: 0 }}>{displayed}</Calligraph>;
}
