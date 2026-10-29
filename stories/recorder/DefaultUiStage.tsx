import type { DefaultUiOptions } from '../../src/recorder/ui/index.ts';
import { useDefaultUiState, type DefaultUiState } from './hooks/use-default-ui-state.ts';

export type DefaultUiStageProps = {
  state: DefaultUiState;
  theme?: 'dark' | 'light';
  /** A host's copy and number formatting, as passed to `createDefaultUi()`. */
  copy?: Pick<DefaultUiOptions, 'messages' | 'locale' | 'format'>;
};

/** A quiet host page behind the default UI, which mounts itself on `document.body` like it does in production. */
export function DefaultUiStage({ state, theme = 'dark', copy }: DefaultUiStageProps) {
  useDefaultUiState(state, {
    ...copy,
    theme,
    privacyMode: 'masked',
    completion: { actions: [{ id: 'open-replay', kind: 'link', label: 'Open replay', href: 'https://replays.example/r/demo-42' }] },
  });
  return (
    <section className="rec-shop" aria-label="Host page">
      <p className="rec-eyebrow">Host page</p>
      <p className="rec-muted">The recorder UI below is mounted by createDefaultUi() in a shadow root, outside this page's styles.</p>
    </section>
  );
}
