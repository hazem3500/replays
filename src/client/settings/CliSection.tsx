import { useQuery } from '@tanstack/react-query';

import { AgentCredentials } from './AgentCredentials.tsx';
import { CommandField } from './CommandField.tsx';
import { configQuery, serverUrl, SETTINGS_LINKS, shellQuote } from './config-query.ts';
import { ExternalLink, SettingsGroup } from './rows.tsx';
import { strings } from './strings.ts';

export function CliSection() {
  const config = useQuery(configQuery);
  if (config.isPending)
    return (
      <p role="status" className="settings-intro">
        {strings.cli.loading}
      </p>
    );
  if (config.isError)
    return (
      <div role="alert" className="settings-intro settings-error">
        <p>{strings.cli.loadFailed}</p>
        <button
          type="button"
          className="settings-text-button"
          onClick={() => {
            void config.refetch();
          }}
        >
          {strings.cli.retry}
        </button>
      </div>
    );
  const auth = config.data.auth;
  const anonymous = auth === 'none';
  const deviceLogin = Boolean(config.data.cliDeviceAuth);
  const uploadHint = anonymous
    ? strings.cli.uploadOpen
    : deviceLogin
      ? strings.cli.uploadDevice
      : auth === 'oidc'
        ? strings.cli.uploadOidc
        : auth === 'header'
          ? strings.cli.uploadHeader
          : strings.cli.uploadOther;
  return (
    <>
      <p className="settings-intro">
        {anonymous ? strings.cli.accessOpen : deviceLogin ? strings.cli.accessDevice : strings.cli.accessManaged}
      </p>
      <SettingsGroup title={strings.cli.connect}>
        <CommandField
          label={strings.cli.connectCommand}
          command={`replays connect ${shellQuote(serverUrl())} && replays doctor`}
          hint={anonymous ? strings.cli.connectHint : strings.cli.connectHintSignIn}
        />
      </SettingsGroup>
      {deviceLogin ? (
        <SettingsGroup title={strings.cli.signIn}>
          <CommandField label={strings.cli.signInCommand} command="replays login" hint={strings.cli.signInHint} />
        </SettingsGroup>
      ) : null}
      <SettingsGroup title={strings.cli.upload}>
        <CommandField
          label={strings.cli.uploadCommand}
          command={`replays upload replay.json${anonymous || deviceLogin ? '' : ' --header-file headers.json'}`}
          hint={uploadHint}
        />
      </SettingsGroup>
      <div className="settings-group settings-credentials">
        <AgentCredentials />
        <p className="settings-group-footer">{strings.cli.agentsHint}</p>
      </div>
      <nav className="settings-links" aria-label={strings.sections.cli}>
        <ExternalLink href={SETTINGS_LINKS.cli}>{strings.cli.cliGuide}</ExternalLink>
        <ExternalLink href={SETTINGS_LINKS.auth}>{strings.cli.authGuide}</ExternalLink>
      </nav>
    </>
  );
}
