import { useQuery } from '@tanstack/react-query';
import { LogOutIcon, UserRoundIcon } from 'lucide-react';

import { Hint } from '@/components/icon-button.tsx';
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

import { type Account, meQuery, queryClient } from '../queries.ts';
import type { TopbarMenuItem } from '../Topbar.tsx';

const STRINGS = {
  account: 'Account',
  signedInAs: (who: string) => `Signed in as ${who}`,
  signOut: 'Sign out',
};

/**
 * The signed-in person, or undefined while unknown or when nobody is signed in (AUTH_MODE=none). Reads the app's one
 * query client directly, so a top bar rendered outside the provider (a story, an isolated test) shows no account.
 */
export function useSignedIn(): Account | undefined {
  const me = useQuery(meQuery, queryClient).data;
  return me?.session?.signedIn ? me : undefined;
}

const who = (account: Account) => account.name ?? account.email ?? account.id;

/** Phones: the account as More items (the bar keeps its room for the title): who is signed in, then Sign out. */
export function accountMenuItems(account: Account | undefined): TopbarMenuItem[] {
  if (!account?.session?.signOutUrl) return [];
  return [
    {
      label: STRINGS.signOut,
      icon: <LogOutIcon aria-hidden="true" />,
      href: account.session.signOutUrl,
      onSelect: () => {},
      detail: who(account),
      testId: 'sign-out',
    },
  ];
}

/** Desktop: one quiet account button; its menu names who is signed in and, when the auth mode can, signs them out. */
export function AccountMenu({ account }: { account: Account }) {
  const signOutUrl = account.session?.signOutUrl;
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
        {signOutUrl ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<a href={signOutUrl} className="menu-link" />} data-testid="sign-out">
              <LogOutIcon aria-hidden="true" />
              {STRINGS.signOut}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
