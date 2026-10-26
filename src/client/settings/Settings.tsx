import { useQuery } from '@tanstack/react-query';
import { CheckIcon, CopyIcon, KeyRoundIcon, MoonIcon, SunIcon, UserRoundIcon } from 'lucide-react';
import { useState } from 'react';

import { Hint } from '@/components/icon-button.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx';

import type { ClientConfig } from '../config.ts';
import { apiUrl } from '../route.ts';
import { useThemeControls } from '../theme.tsx';
import { AgentCredentials } from './AgentCredentials.tsx';

const AUTH_DOCS = 'https://github.com/hazem3500/replays#authentication';
const CLI_DOCS = 'https://github.com/hazem3500/replays#quick-start';

/** Settings stay in context; the same dialog becomes a full-height surface on small screens. */
export function SettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Hint label="Settings" side="bottom" align="end">
        <DialogTrigger
          render={<Button variant="ghost" size="icon" aria-label="Settings" className="text-muted-foreground [&_svg]:size-4" />}
        >
          <UserRoundIcon aria-hidden="true" />
        </DialogTrigger>
      </Hint>
      <DialogContent className="flex max-h-[min(620px,calc(100dvh-48px))] flex-col gap-5 overflow-y-auto p-6 max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:pb-[max(24px,env(safe-area-inset-bottom))] sm:w-[560px] sm:max-w-[calc(100vw-48px)]">
        <DialogHeader className="pr-10">
          <DialogTitle className="text-base">Settings</DialogTitle>
          <DialogDescription>Make this workspace yours and connect your tools.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="appearance" className="min-h-[276px] gap-5">
          <TabsList aria-label="Settings sections" variant="line" className="w-full justify-start gap-4 border-b border-border p-0 pb-2">
            <TabsTrigger value="appearance" className="flex-none px-0 py-1">
              Appearance
            </TabsTrigger>
            <TabsTrigger value="agents" className="flex-none px-0 py-1">
              Agent access
            </TabsTrigger>
          </TabsList>
          <TabsContent value="appearance">
            <Appearance />
          </TabsContent>
          <TabsContent value="agents">{open ? <AgentAccess enabled={open} /> : null}</TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function Appearance() {
  const { theme, switchTheme } = useThemeControls();
  return (
    <section aria-labelledby="settings-appearance" className="space-y-4">
      <div>
        <h2 id="settings-appearance" className="text-sm font-medium">
          Color theme
        </h2>
        <p className="mt-1 text-muted-foreground">Choose how Replays looks in this browser.</p>
      </div>
      <div role="group" aria-label="Color theme" className="grid grid-cols-2 gap-3">
        {(['light', 'dark'] as const).map((value) => {
          const Icon = value === 'light' ? SunIcon : MoonIcon;
          return (
            <Button
              key={value}
              variant="outline"
              aria-pressed={theme === value}
              className="h-20 flex-col gap-2 rounded-lg aria-pressed:border-primary aria-pressed:bg-primary/5"
              onClick={() => {
                if (theme !== value) switchTheme();
              }}
            >
              <Icon className="size-4" aria-hidden="true" />
              {value === 'light' ? 'Light' : 'Dark'}
            </Button>
          );
        })}
      </div>
      <p className="text-muted-foreground">Your choice is saved on this device. Motion follows your system’s reduced-motion preference.</p>
    </section>
  );
}

function AgentAccess({ enabled }: { enabled: boolean }) {
  const config = useQuery({
    queryKey: ['config'],
    queryFn: async ({ signal }) => {
      const response = await fetch(apiUrl('config'), { signal });
      if (!response.ok) throw new Error('Connection settings could not be loaded.');
      return (await response.json()) as ClientConfig;
    },
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const endpoint = new URL(apiUrl('replays'), window.location.origin).href;
  const anonymous = config.data?.auth === 'none';
  const command = `replays upload replay.json --upload-url '${endpoint.replaceAll("'", "'\\''")}'${anonymous ? '' : ' --header-file headers.json'}`;
  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }
  return (
    <section aria-labelledby="settings-agent-access" className="space-y-4">
      <div>
        <h2 id="settings-agent-access" className="flex items-center gap-2 text-sm font-medium">
          <KeyRoundIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          Connect an agent
        </h2>
        <p className="mt-1 text-muted-foreground">Record with the Replays CLI, then upload to this workspace.</p>
      </div>
      {config.isPending ? (
        <p role="status" className="text-muted-foreground">
          Loading connection settings…
        </p>
      ) : config.isError ? (
        <div role="alert" className="space-y-2">
          <p>Connection settings could not be loaded.</p>
          <Button
            variant="outline"
            onClick={() => {
              void config.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-border p-3">
            <p className="font-medium">{anonymous ? 'Open access' : 'Managed authentication'}</p>
            <p className="mt-1 text-muted-foreground">
              {anonymous
                ? 'This deployment does not require sign-in. Only use it on a trusted network.'
                : 'Access is managed by this deployment’s authentication provider. Your browser session is not automatically shared with agents.'}
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-medium">Upload an existing recording</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void copyCommand();
                }}
                aria-label="Copy upload command"
              >
                {copyState === 'copied' ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}Copy
              </Button>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-[11px] leading-relaxed">
              <code>{command}</code>
            </pre>
            <p role="status" className="text-muted-foreground">
              {copyState === 'copied'
                ? 'Command copied.'
                : copyState === 'failed'
                  ? 'Copy is unavailable. Select the command to copy it.'
                  : anonymous
                    ? 'Run this command where your recording is saved.'
                    : 'Use a private headers.json file containing the credentials accepted by your deployment. Keep it out of source control.'}
            </p>
          </div>
          <AgentCredentials />
        </>
      )}
      <div className="flex gap-4 text-primary">
        <a href={CLI_DOCS} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
          CLI guide ↗
        </a>
        <a href={AUTH_DOCS} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
          Authentication guide ↗
        </a>
      </div>
    </section>
  );
}
