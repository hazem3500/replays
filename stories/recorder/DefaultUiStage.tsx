import { useDefaultUiState, type DefaultUiState } from './hooks/use-default-ui-state.ts';

export type DefaultUiStageProps = { state: DefaultUiState; theme?: 'dark' | 'light' };

/** A quiet host page behind the default UI, which mounts itself on `document.body` like it does in production. */
export function DefaultUiStage({ state, theme = 'dark' }: DefaultUiStageProps) {
  useDefaultUiState(state, {
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
