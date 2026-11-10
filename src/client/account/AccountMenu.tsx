import { useQuery } from '@tanstack/react-query';
import { LogOutIcon, UnlinkIcon, UserRoundIcon } from 'lucide-react';

import { Hint } from '@/components/icon-button.tsx';
import { ProviderIcon } from '@/components/provider-icon.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';

import { type Account, configQuery, githubLinkQuery, meQuery, queryClient } from '../queries.ts';
import type { TopbarMenuItem } from '../Topbar.tsx';
import { disconnectGithub, githubConnectHref } from './github.ts';

const STRINGS = {
  account: 'Account',
  signedInAs: (who: string) => `Signed in as ${who}`,
  signOut: 'Sign out',
  connectGithub: 'Connect GitHub',
  disconnectGithub: 'Disconnect GitHub',
  githubAs: (login: string) => `GitHub: ${login}`,
};

/**
 * The signed-in person, or undefined while unknown or when nobody is signed in (AUTH_MODE=none). Reads the app's one
 * query client directly, so a top bar rendered outside the provider (a story, an isolated test) shows no account.
 */
export function useSignedIn(): Account | undefined {
  const me = useQuery(meQuery, queryClient).data;
  const signedIn = Boolean(me?.session?.signedIn);
  const config = useQuery(configQuery, queryClient).data;
  // why: asked only where the host set a GitHub OAuth app (the plugin is listed), so everywhere else adds no request.
  const listed = Boolean(config?.plugins?.includes('github-connect'));
  const github = useQuery({ ...githubLinkQuery, enabled: signedIn && listed }, queryClient).data;
  if (!me || !signedIn) return undefined;
  return listed && github && (github.available || github.linked) ? { ...me, github } : me;
}

/** Whether the menu has anything to offer beside the account's name: a way to sign out, or Connect GitHub. */
export const hasAccountActions = (account: Account) => Boolean(account.session?.signOutUrl || account.github);

const who = (account: Account) => account.name ?? account.email ?? account.id;

/** Phones: the account as More items (the bar keeps its room for the title): who is signed in, then Sign out. */
export function accountMenuItems(account: Account | undefined): TopbarMenuItem[] {
  if (!account) return [];
  const { github } = account;
  const signOutUrl = account.session?.signOutUrl;
  return [
    ...(github?.linked
      ? [
          {
            label: STRINGS.disconnectGithub,
            icon: <UnlinkIcon aria-hidden="true" />,
            onSelect: () => void disconnectGithub(),
            detail: github.linked.login,
            testId: 'github-disconnect',
          },
        ]
      : github?.available
        ? [
            {
              label: STRINGS.connectGithub,
              icon: <ProviderIcon provider="github" size={16} />,
              href: githubConnectHref(),
              onSelect: () => {},
              testId: 'github-connect',
            },
          ]
        : []),
    ...(signOutUrl
      ? [{ label: STRINGS.signOut, icon: <LogOutIcon aria-hidden="true" />, href: signOutUrl, onSelect: () => {}, detail: who(account), testId: 'sign-out' }]
      : []),
  ];
}

/**
 * Desktop: one quiet account button that names who is signed in, links GitHub where the host offers it and signs them
 * out. With neither (IAP without Connect GitHub) it renders nothing — a label-only control is noise next to the rest of the bar.
 */
export function AccountMenu({ account }: { account: Account }) {
  const signOutUrl = account.session?.signOutUrl;
  const github = account.github;
  if (!hasAccountActions(account)) return null;
  return (
    <DropdownMenu>
      <Hint label={STRINGS.account} side="bottom" align="end">
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="topbar-account text-[var(--text-secondary)] hover:text-foreground [&_svg:not([class*=size-])]:size-4"
              aria-label={`${STRINGS.account}: ${who(account)}`}
              data-testid="account-menu"
            />
          }
        >
          {account.avatarUrl ? <img className="topbar-avatar" src={account.avatarUrl} alt="" /> : <UserRoundIcon aria-hidden="true" />}
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent side="bottom" align="end" className="w-auto min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal text-[var(--text-secondary)]">{STRINGS.signedInAs(who(account))}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {github?.linked ? (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center gap-2 font-normal text-[var(--text-secondary)]" data-testid="github-linked">
                {github.linked.avatarUrl ? (
                  <img className="topbar-avatar" src={github.linked.avatarUrl} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <ProviderIcon provider="github" size={16} />
                )}
                {STRINGS.githubAs(github.linked.login)}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuItem onClick={() => void disconnectGithub()} data-testid="github-disconnect">
              <UnlinkIcon aria-hidden="true" />
              {STRINGS.disconnectGithub}
            </DropdownMenuItem>
          </>
        ) : github?.available ? (
          <DropdownMenuItem render={<a href={githubConnectHref()} className="menu-link" />} data-testid="github-connect">
            <ProviderIcon provider="github" size={16} />
            {STRINGS.connectGithub}
          </DropdownMenuItem>
        ) : null}
        {signOutUrl ? (
          <>
            {github?.linked || github?.available ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem render={<a href={signOutUrl} className="menu-link" aria-label={STRINGS.signOut} />} data-testid="sign-out">
              <LogOutIcon aria-hidden="true" />
              {STRINGS.signOut}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
