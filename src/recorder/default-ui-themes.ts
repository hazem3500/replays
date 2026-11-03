import type { RecorderTheme } from './default-ui-types.ts';

/** The `theme: 'light' | 'dark'` presets, the Replays palette in each scheme with a vivid live-red for the recording dot and Stop. */
export const RECORDER_THEME_PRESETS: Record<'light' | 'dark', RecorderTheme> = {
  light: {
    background: '#ffffff',
    foreground: '#181b22',
    secondary: '#434a59',
    border: '#dde0e7',
    borderStrong: '#c1c6d1',
    hover: '#eceef3',
    pressed: '#e3e6ed',
    primary: '#3d4fd1',
    primaryForeground: '#ffffff',
    danger: '#d92d20',
  },
  dark: {
    background: '#1a1e26',
    foreground: '#eef0f5',
    secondary: '#b2b8c5',
    border: '#262b35',
    borderStrong: '#3a4150',
    hover: '#232832',
    pressed: '#2c323d',
    primary: '#8b9dff',
    primaryForeground: '#10131b',
    danger: '#ff5f57',
  },
};
