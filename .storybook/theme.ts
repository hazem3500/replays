import { create } from 'storybook/theming';

/** The app's timeline mark (public/assets/brand/favicon.svg) beside the wordmark, coloured per theme. */
const logo = (accent: string, ink: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="148" height="32" viewBox="0 0 148 32"><g fill="${accent}"><rect x="1" y="15" width="7" height="6" rx="3"/><rect x="9.8" y="15" width="3" height="6" rx="3"/><rect x="21.2" y="15" width="4.4" height="6" rx="3" fill-opacity=".35"/><rect x="27.6" y="15" width="3.4" height="6" rx="3" fill-opacity=".35"/><rect x="14.8" y="8.8" width="4.4" height="18.7" rx="2.2"/><circle cx="17" cy="8.8" r="4.4"/></g><text x="40" y="23" fill="${ink}" font-family="Inter Variable,Inter,system-ui,sans-serif" font-weight="600" font-size="19" letter-spacing="-.4">Replays UI</text></svg>`,
  )}`;

const shared = {
  brandTitle: 'Replays UI',
  brandUrl: '?path=/docs/introduction--docs',
  brandTarget: '_self',
  fontBase: '"Inter Variable", Inter, system-ui, sans-serif',
  fontCode: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  appBorderRadius: 10,
  inputBorderRadius: 8,
};

/** Mirrors the dark tokens in src/client/styles.css. */
export const dark = create({
  ...shared,
  base: 'dark',
  brandImage: logo('#8b9dff', '#eef0f5'),
  colorPrimary: '#8b9dff',
  colorSecondary: '#8b9dff',
  appBg: '#0c0e12',
  appContentBg: '#11141a',
  appPreviewBg: '#11141a',
  appBorderColor: '#262b35',
  textColor: '#eef0f5',
  textMutedColor: '#b2b8c5',
  textInverseColor: '#0b0f24',
  barTextColor: '#b2b8c5',
  barHoverColor: '#eef0f5',
  barSelectedColor: '#8b9dff',
  barBg: '#11141a',
  buttonBg: '#1a1e26',
  buttonBorder: '#3a4150',
  inputBg: '#1a1e26',
  inputBorder: '#3a4150',
  inputTextColor: '#eef0f5',
});

/** Mirrors the light tokens in src/client/styles.css. */
export const light = create({
  ...shared,
  base: 'light',
  brandImage: logo('#3d4fd1', '#181b22'),
  colorPrimary: '#3d4fd1',
  colorSecondary: '#3d4fd1',
  appBg: '#eff1f5',
  appContentBg: '#f6f7fa',
  appPreviewBg: '#f6f7fa',
  appBorderColor: '#dde0e7',
  textColor: '#181b22',
  textMutedColor: '#434a59',
  textInverseColor: '#ffffff',
  barTextColor: '#434a59',
  barHoverColor: '#181b22',
  barSelectedColor: '#3d4fd1',
  barBg: '#ffffff',
  buttonBg: '#ffffff',
  buttonBorder: '#c1c6d1',
  inputBg: '#ffffff',
  inputBorder: '#c1c6d1',
  inputTextColor: '#181b22',
});
