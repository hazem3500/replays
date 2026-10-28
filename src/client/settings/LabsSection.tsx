import { useId } from 'react';

import { EmptyState } from '@/components/ui/empty-state.tsx';
import { Switch } from '@/components/ui/switch.tsx';

import { type BetaFlag, labsFlags } from '../../shared/beta-flags.ts';
import { SETTINGS_LINKS } from './config-query.ts';
import { betaAllowedFlags, useBetaFlag } from './labs.ts';
import { ExternalLink, SettingsGroup, SettingsRow } from './rows.tsx';
import { strings } from './strings.ts';

function LabsRow({ flag }: { flag: BetaFlag }) {
  const { enabled, pendingReload, setEnabled } = useBetaFlag(flag.id);
  const labelId = useId();
  return (
    <SettingsRow
      label={flag.label}
      labelId={labelId}
      description={
        <>
          {flag.description}
          {pendingReload ? (
            <span className="settings-reload">
              {strings.labs.reload} ·{' '}
              <button type="button" className="settings-text-button" onClick={() => window.location.reload()}>
                {strings.labs.reloadNow}
              </button>
            </span>
          ) : null}
        </>
      }
      control={<Switch aria-labelledby={labelId} checked={enabled} onCheckedChange={(checked) => setEnabled(checked)} />}
    />
  );
}

export function LabsSection() {
  const flags = labsFlags(betaAllowedFlags());
  if (!flags.length)
    return (
      <EmptyState
        variant="compact"
        icon="sparkles"
        title={strings.labs.noneTitle}
        body={strings.labs.noneHint}
        actions={[{ id: 'docs', label: strings.labs.docs, href: SETTINGS_LINKS.labs, external: true }]}
        testId="labs-empty"
      />
    );
  return (
    <>
      <p className="settings-intro">{strings.labs.intro}</p>
      <SettingsGroup
        title={strings.labs.experiments}
        footer={
          <>
            {strings.savedInBrowser} {strings.labs.footer} <ExternalLink href={SETTINGS_LINKS.labs}>{strings.labs.docs}</ExternalLink>
          </>
        }
      >
        {flags.map((flag) => (
          <LabsRow key={flag.id} flag={flag} />
        ))}
      </SettingsGroup>
    </>
  );
}
