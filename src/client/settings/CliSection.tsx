import { useQuery } from '@tanstack/react-query';

import { Disclosure } from '@/components/ui/disclosure.tsx';

import { AgentCredentials } from './AgentCredentials.tsx';
import { CommandField } from './CommandField.tsx';
import { configQuery } from '../queries.ts';
import { serverUrl, SETTINGS_LINKS, shellQuote } from './config-query.ts';
import { ExternalLink, SettingsGroup } from './rows.tsx';
import { strings } from './strings.ts';

type SignInMode = 'open' | 'device' | 'managed';

function signInMode(auth: string, deviceLogin: boolean): SignInMode {
  if (auth === 'none') return 'open';
  return deviceLogin ? 'device' : 'managed';
}

const ACCESS: Record<SignInMode, string> = {
  open: strings.cli.accessOpen,
  device: strings.cli.accessDevice,
  managed: strings.cli.accessManaged,
};

const UPLOAD_HINTS: Record<Exclude<SignInMode, 'managed'>, string> = { open: strings.cli.uploadOpen, device: strings.cli.uploadDevice };

/** Host-managed sign-in: what headers.json carries depends on the auth adapter. */
const MANAGED_UPLOAD_HINTS: Partial<Record<string, string>> = { oidc: strings.cli.uploadOidc, header: strings.cli.uploadHeader };

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
  const mode = signInMode(auth, deviceLogin);
  return (
    <div className="settings-cli">
      <dl className="cli-access">
        <dt>{strings.cli.access}</dt>
        <dd>{ACCESS[mode]}</dd>
      </dl>
      <SettingsGroup title={strings.cli.install}>
        <p className="cli-source">
          {strings.cli.installIntro} <ExternalLink href={SETTINGS_LINKS.cli}>{strings.cli.source}</ExternalLink>
        </p>
        <CommandField
          label={strings.cli.installCommand}
          command="pnpm install --frozen-lockfile && pnpm build && pnpm build:cli && npm install -g ."
          hint={strings.cli.installHint}
        />
      </SettingsGroup>
      <SettingsGroup title={strings.cli.connect}>
        <CommandField
          label={strings.cli.connectCommand}
          command={`replays connect ${shellQuote(serverUrl())} && replays doctor`}
          hint={strings.cli.connectHint}
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
          hint={mode === 'managed' ? (MANAGED_UPLOAD_HINTS[auth] ?? strings.cli.uploadOther) : UPLOAD_HINTS[mode]}
        />
      </SettingsGroup>
      <Disclosure className="settings-group settings-credentials" summary={strings.cli.agentsAdvanced}>
        <AgentCredentials />
        <p className="settings-group-footer">{strings.cli.agentsHint}</p>
      </Disclosure>
      <nav className="settings-links" aria-label={strings.sections.cli}>
        <ExternalLink href={SETTINGS_LINKS.cli}>{strings.cli.cliGuide}</ExternalLink>
        <ExternalLink href={SETTINGS_LINKS.auth}>{strings.cli.authGuide}</ExternalLink>
      </nav>
    </div>
  );
}
