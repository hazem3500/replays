import { GlobeIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

import { posterPlaceholderUrl } from './thumbhash-url.ts';

/**
 * A page without its picture: a faint browser bar over a calm surface, a site glyph and the host in the middle.
 * why: never the recorded site's own favicon; loading it would make every viewer's browser contact the recorded host.
 */
function SiteTile({ host }: { host: string }) {
  return (
    <span className="poster-site">
      <span className="poster-site-bar" />
      <span className="poster-site-mark">
        <span className="poster-site-chip">
          <GlobeIcon className="poster-site-icon" aria-hidden="true" />
        </span>
        {host ? <span className="poster-site-host">{host.replace(/^www\./, '')}</span> : null}
      </span>
    </span>
  );
}

/** A tile painted from a ThumbHash: the poster's own colours and shape, framed like the image. */
function HashTile({ url, className }: { url: string; className: string }) {
  const paint: CSSProperties = { backgroundImage: `url("${url}")` };
  return <span className={className} data-thumbhash="" style={paint} />;
}

/** A missing poster shows the leading replay’s ThumbHash or recorded host. */
export function PosterPlaceholder({ host, thumbhash, fallback }: { host: string; thumbhash: string | undefined; fallback: ReactNode }) {
  const hash = posterPlaceholderUrl(thumbhash);
  if (fallback) return <span className="poster-placeholder">{fallback}</span>;
  if (hash) return <HashTile url={hash} className="poster-placeholder" />;
  return (
    <span className="poster-placeholder">
      <SiteTile host={host} />
    </span>
  );
}
