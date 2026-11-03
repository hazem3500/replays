import type { DefaultUiOptions, RecorderTheme } from '../../src/recorder/ui/index.ts';
import { useDefaultUiState, type DefaultUiState } from './hooks/use-default-ui-state.ts';

/** A host design system mapped onto the `--recorder-*` tokens: its own magenta accent, red, font and radius. */
const HOST_THEMES: Record<'dark' | 'light', RecorderTheme> = {
  dark: {
    background: '#1c1d22',
    foreground: '#f3f2f5',
    secondary: '#a8a4ad',
    border: '#2c2d34',
    borderStrong: '#40414a',
    hover: '#26272e',
    pressed: '#30313a',
    primary: '#e57cd8',
    primaryForeground: '#2c1338',
    danger: '#ff6b7f',
    radius: '8px',
  },
  light: {
    background: '#ffffff',
    foreground: '#2c1338',
    secondary: '#5e4b66',
    border: '#e8e1ea',
    borderStrong: '#cfc4d3',
    hover: '#f5f0f6',
    pressed: '#ece4ee',
    primary: '#a33f9b',
    primaryForeground: '#ffffff',
    danger: '#e2445c',
    radius: '8px',
  },
};

export type DefaultUiStageProps = {
  state: DefaultUiState;
  theme?: 'dark' | 'light';
  /** `host` maps a host design system's palette onto the theme tokens instead of the built-in preset. */
  palette?: 'replays' | 'host';
  /** `copy-only` passes a host `completion.actions` list in place of the Open and Copy link defaults. */
  actions?: 'default' | 'copy-only';
  /** A host's copy and number formatting, as passed to `createDefaultUi()`. */
  copy?: Pick<DefaultUiOptions, 'messages' | 'locale' | 'format'>;
};

/** A quiet host page behind the default UI, which mounts itself on `document.body` like it does in production. */
export function DefaultUiStage({ state, theme = 'dark', palette = 'replays', actions = 'default', copy }: DefaultUiStageProps) {
  useDefaultUiState(state, {
    ...copy,
    theme: palette === 'host' ? HOST_THEMES[theme] : theme,
    privacyMode: 'masked',
    ...(actions === 'copy-only' ? { completion: { actions: [{ id: 'copy-link', kind: 'copy', label: 'Copy link' }] } } : {}),
  });
  return (
    <section className="rec-shop" aria-label="Host page">
      <p className="rec-eyebrow">Host page</p>
      <p className="rec-muted">The recorder UI below is mounted by createDefaultUi() in a shadow root, outside this page's styles.</p>
    </section>
  );
}
