import { useQuery } from '@tanstack/react-query';

import { Disclosure } from '@/components/ui/disclosure.tsx';

import { AgentCredentials } from './AgentCredentials.tsx';
import { CommandField } from './CommandField.tsx';
import { configQuery } from '../queries.ts';
import { helpLink, serverUrl, shellQuote } from './config-query.ts';
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
  const host = config.data.cli ?? {};
  const sourceLink = helpLink(config.data, 'source');
  const cliGuide = helpLink(config.data, 'cliGuide');
  const authGuide = helpLink(config.data, 'authGuide');
  return (
    <div className="settings-cli">
      <dl className="cli-access">
        <dt>{strings.cli.access}</dt>
        <dd>{ACCESS[mode]}</dd>
      </dl>
      <SettingsGroup title={strings.cli.install}>
        {host.install ? null : (
          <p className="cli-source">
            {strings.cli.installIntro}
            {sourceLink ? (
              <>
                {' '}
                <ExternalLink href={sourceLink}>{strings.cli.source}</ExternalLink>
              </>
            ) : null}
          </p>
        )}
        <CommandField
          label={strings.cli.installCommand}
          command={host.install ?? 'pnpm install --frozen-lockfile && pnpm build && pnpm build:cli && npm install -g .'}
          hint={host.install ? host.installHint : strings.cli.installHint}
        />
      </SettingsGroup>
      <SettingsGroup title={strings.cli.connect}>
        <CommandField
          label={host.connect ? strings.cli.signInCommand : strings.cli.connectCommand}
          command={host.connect ?? `replays connect ${shellQuote(serverUrl())} && replays doctor`}
          hint={host.connect ? host.connectHint : strings.cli.connectHint}
        />
      </SettingsGroup>
      {deviceLogin && !host.connect ? (
        <SettingsGroup title={strings.cli.signIn}>
          <CommandField label={strings.cli.signInCommand} command="replays login" hint={strings.cli.signInHint} />
        </SettingsGroup>
      ) : null}
      <SettingsGroup title={strings.cli.upload}>
        <CommandField
          label={strings.cli.uploadCommand}
          command={host.upload ?? `replays upload replay.json${anonymous || deviceLogin ? '' : ' --header-file headers.json'}`}
          hint={host.upload ? host.uploadHint : mode === 'managed' ? (MANAGED_UPLOAD_HINTS[auth] ?? strings.cli.uploadOther) : UPLOAD_HINTS[mode]}
        />
      </SettingsGroup>
      <Disclosure className="settings-group settings-credentials" summary={strings.cli.agentsAdvanced}>
        <AgentCredentials />
        <p className="settings-group-footer">{strings.cli.agentsHint}</p>
      </Disclosure>
      {cliGuide || authGuide ? (
        <nav className="settings-links" aria-label={strings.sections.cli}>
          {cliGuide ? <ExternalLink href={cliGuide}>{strings.cli.cliGuide}</ExternalLink> : null}
          {authGuide ? <ExternalLink href={authGuide}>{strings.cli.authGuide}</ExternalLink> : null}
        </nav>
      ) : null}
    </div>
  );
}
