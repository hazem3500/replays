import type { ProfileInfo } from '../../../shared/profiles.ts';
import type { SlotDescriptor } from '../../plugins/slots.ts';

/* why: the index's first-run state is data. Each way to get a first replay is an `index.empty.ways` slot item: the
 * built-ins below (`core:*`), and whatever a deployment adds through the plugin registry (e.g. a chat assistant
 * card) — `registerSlotItem('index.empty.ways', { id: 'plugin:<owner>:<id>', order, render: (context) => way })`.
 * `render` returns plain data (a FirstRunWay), so a plugin needs no React.
 */

export const FIRST_RUN_SLOT = 'index.empty.ways';

export const firstRunStrings = {
  title: 'Your first replay',
  lead: 'A replay is a browser session with its page, console and network activity on one timeline. Pick a way to make one.',
  waysLabel: 'Ways to add a replay',
  copy: 'Copy',
  copied: 'Copied',
  copyFailed: 'Copy failed',
  copyLabel: (label: string) => `Copy: ${label}`,
  profilesTitle: 'Replays here are sorted by profile',
  keptFor: (days: number) => (days === 0 ? 'kept until deleted' : `kept ${days} ${days === 1 ? 'day' : 'days'}`),
  record: {
    title: 'Record in your app',
    description: 'Add the in-page recorder; people record a problem with one click and it lands here.',
    commandLabel: 'Recorder, in your app',
    guide: 'Recorder guide',
  },
  upload: {
    title: 'Upload a file',
    description: 'A replay.json, or an rrweb export recorded with inputs masked.',
    drop: 'Drop a file here or anywhere on the page',
    choose: 'Choose a file',
    badge: 'Quickest',
  },
  cli: {
    title: 'Capture from code',
    description: 'Script a run with the command-line tool and upload it to this server.',
    commandLabel: 'Capture a page',
    more: 'Import an rrweb recording instead',
    moreLabel: 'Import an rrweb recording',
  },
  agent: {
    title: 'Ask your coding agent',
    description: 'Add the Replays MCP server to your agent, then ask it to record the flow you want to see.',
    commandLabel: 'MCP server command',
  },
} as const;

export interface FirstRunCommand {
  label: string;
  text: string;
}

/** One way to get a first replay. Plain data, so deployments can contribute cards without React. */
export interface FirstRunWay {
  title: string;
  description: string;
  icon?: 'record' | 'upload' | 'cli' | 'agent' | 'link';
  badge?: string;
  command?: FirstRunCommand;
  /** A second command behind a disclosure. */
  more?: { label: string; command: FirstRunCommand };
  /** A drop zone with a "choose a file" button inside (only the built-in upload way). */
  dropZone?: { label: string; button: string; onChoose: () => void };
  action?: { label: string; href: string };
}

export interface FirstRunContext {
  origin: string;
  uploadUrl: string;
  chooseFile: () => void;
  profiles: readonly ProfileInfo[];
}

const RECORDER_SNIPPET = `import { createGuidedRecorder } from '@hazem3500/replays/recorder/ui';

const recorder = createGuidedRecorder({ upload });
button.addEventListener('click', () => recorder.request());`;

export const coreWays: ReadonlyArray<SlotDescriptor<FirstRunContext, FirstRunWay>> = [
  {
    id: 'core:upload',
    order: 100,
    render: (context) => ({
      title: firstRunStrings.upload.title,
      description: firstRunStrings.upload.description,
      icon: 'upload',
      badge: firstRunStrings.upload.badge,
      dropZone: { label: firstRunStrings.upload.drop, button: firstRunStrings.upload.choose, onChoose: context.chooseFile },
    }),
  },
  {
    id: 'core:record',
    order: 200,
    render: () => ({
      title: firstRunStrings.record.title,
      description: firstRunStrings.record.description,
      icon: 'record',
      command: { label: firstRunStrings.record.commandLabel, text: RECORDER_SNIPPET },
      action: { label: firstRunStrings.record.guide, href: 'https://github.com/hazem3500/replays/blob/main/docs/recorder.md' },
    }),
  },
  {
    id: 'core:cli',
    order: 300,
    render: (context) => ({
      title: firstRunStrings.cli.title,
      description: firstRunStrings.cli.description,
      icon: 'cli',
      command: {
        label: firstRunStrings.cli.commandLabel,
        text: `replays capture --url https://example.com --upload-url ${context.uploadUrl}`,
      },
      more: {
        label: firstRunStrings.cli.more,
        command: {
          label: firstRunStrings.cli.moreLabel,
          text: `replays import --rrweb events.json --title "Checkout bug" --upload-url ${context.uploadUrl}`,
        },
      },
    }),
  },
  {
    id: 'core:agent',
    order: 400,
    render: (context) => ({
      title: firstRunStrings.agent.title,
      description: firstRunStrings.agent.description,
      icon: 'agent',
      command: {
        label: firstRunStrings.agent.commandLabel,
        text: `replays connect ${context.origin}\n# then register this MCP server (stdio) with your agent:\nreplays mcp`,
      },
    }),
  },
];
