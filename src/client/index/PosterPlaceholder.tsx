import { GlobeIcon } from 'lucide-react';
import { type CSSProperties, type ReactNode, useState } from 'react';

import type { ReviewSuiteIndexRun } from '../../shared/review-suite.ts';
import { posterPlaceholderUrl } from './thumbhash-url.ts';

/** The most runs a suite's mosaic shows; the run count badge says how many there are. */
const MOSAIC_RUNS = 4;

/** `https://host/favicon.ico` for the recorded page's origin; undefined when the URL is not http(s). */
function faviconFor(url: string | undefined): string | undefined {
  try {
    const { origin, protocol } = new URL(url ?? '');
    return protocol === 'https:' || protocol === 'http:' ? `${origin}/favicon.ico` : undefined;
  } catch {
    return;
  }
}

/** The recorded site's favicon; a globe when it has none or it cannot load (an internal host, a blocked request). */
function SiteIcon({ url }: { url: string | undefined }) {
  const src = faviconFor(url);
  const [failed, setFailed] = useState<string>();
  if (!src || failed === src) return <GlobeIcon className="poster-site-icon" aria-hidden="true" />;
  return (
    <img
      className="poster-site-icon"
      src={src}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      decoding="async"
      draggable={false}
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
    />
  );
}

/** A page without its picture: a faint browser bar over a calm surface, the site's icon and host in the middle. */
function SiteTile({ host, url }: { host: string; url: string | undefined }) {
  return (
    <span className="poster-site">
      <span className="poster-site-bar" />
      <span className="poster-site-mark">
        <span className="poster-site-chip">
          <SiteIcon url={url} />
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

/** One run in a suite's mosaic: its ThumbHash, else its site; hatched when it has no recording. Edged by its status. */
function RunCell({ run }: { run: ReviewSuiteIndexRun }) {
  const hash = posterPlaceholderUrl(run.replay?.thumbhash);
  return (
    <span className="poster-run" data-status={run.status} data-recorded={run.replayId ? '' : undefined}>
      {hash ? <HashTile url={hash} className="poster-run-hash" /> : <SiteTile host={run.replay?.host ?? ''} url={run.replay?.url} />}
      <span className="poster-run-label">{run.label}</span>
    </span>
  );
}

/** A suite without a front poster: its runs side by side, so the card shows what was reviewed and how it went. */
export function RunMosaic({ runs }: { runs: readonly ReviewSuiteIndexRun[] }) {
  const shown = runs.slice(0, MOSAIC_RUNS);
  return (
    <span className="poster-mosaic" data-count={shown.length}>
      {shown.map((run) => (
        <RunCell key={run.id} run={run} />
      ))}
    </span>
  );
}

/**
 * What a poster shows until its picture arrives, and for good when there is none: a suite's run mosaic when given,
 * else the replay's ThumbHash, else its site. Never a made-up letter.
 */
export function PosterPlaceholder({
  host,
  url,
  thumbhash,
  fallback,
}: {
  host: string;
  url: string | undefined;
  thumbhash: string | undefined;
  fallback: ReactNode;
}) {
  const hash = posterPlaceholderUrl(thumbhash);
  if (fallback) return <span className="poster-placeholder">{fallback}</span>;
  if (hash) return <HashTile url={hash} className="poster-placeholder" />;
  return (
    <span className="poster-placeholder">
      <SiteTile host={host} url={url} />
    </span>
  );
}
