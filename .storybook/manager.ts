import { addons } from 'storybook/manager-api';
import { GLOBALS_UPDATED, SET_GLOBALS } from 'storybook/internal/core-events';
import { dark, light } from './theme.ts';

addons.setConfig({ theme: dark, sidebar: { showRoots: true }, panelPosition: 'bottom', enableShortcuts: true });

const follow = ({ globals }: { globals: Record<string, unknown> }) => addons.setConfig({ theme: globals.theme === 'light' ? light : dark });
addons.getChannel().on(SET_GLOBALS, follow);
addons.getChannel().on(GLOBALS_UPDATED, follow);
