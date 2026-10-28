import { useQuery } from '@tanstack/react-query';

import { productName } from '../config.ts';
import { configQuery } from '../queries.ts';
import { serverUrl, SETTINGS_LINKS } from './config-query.ts';
import { ExternalLink, SettingsGroup, SettingsRow } from './rows.tsx';
import { strings } from './strings.ts';

export function AboutSection() {
  const config = useQuery(configQuery);
  const data = config.data;
  const missing = config.isPending ? '…' : strings.about.unknown;
  const version = data?.core ?? missing;
  const auth = data ? (strings.about.auth[data.auth] ?? data.auth) : missing;
  return (
    <>
      <SettingsGroup>
        <SettingsRow label={strings.about.product} control={<span className="settings-value">{data?.name ?? productName()}</span>} />
        <SettingsRow label={strings.about.version} control={<span className="settings-value settings-mono">{version}</span>} />
        {data?.distribution ? (
          <SettingsRow
            label={strings.about.distribution}
            control={
              <span className="settings-value">
                {data.distribution.name} <span className="settings-mono">{data.distribution.version}</span>
              </span>
            }
          />
        ) : null}
        <SettingsRow
          label={strings.about.server}
          control={<span className="settings-value settings-mono settings-truncate">{serverUrl()}</span>}
        />
        <SettingsRow label={strings.about.signIn} control={<span className="settings-value">{auth}</span>} />
      </SettingsGroup>
      <nav className="settings-links" aria-label={strings.about.links}>
        <ExternalLink href={SETTINGS_LINKS.docs}>{strings.about.docs}</ExternalLink>
        <ExternalLink href={SETTINGS_LINKS.issues}>{strings.about.issues}</ExternalLink>
      </nav>
    </>
  );
}
