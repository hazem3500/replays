import { addons } from 'storybook/manager-api';
import { GLOBALS_UPDATED } from 'storybook/internal/core-events';
import { dark, light } from './theme.ts';
const preferred = dark;
addons.setConfig({ theme: preferred, sidebar: { showRoots: true }, panelPosition: 'bottom' });
addons.getChannel().on(GLOBALS_UPDATED, ({ globals }: { globals: Record<string, unknown> }) => {
  addons.setConfig({ theme: globals.theme === 'light' ? light : dark });
});
