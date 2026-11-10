/** Help links a host can point at its own docs, or hide with `false` (see src/server/branding.ts). */
export const LINK_KEYS = ['source', 'cliGuide', 'authGuide', 'labs', 'docs', 'issues', 'recorderGuide'] as const;
export type LinkKey = (typeof LINK_KEYS)[number];
export type LinksConfig = Partial<Record<LinkKey, string | false>>;

/** One line each, shown in a copy field. Setting `connect` replaces the connect and sign-in steps with that one command. */
export interface CliConfig {
  install?: string;
  installHint?: string;
  connect?: string;
  connectHint?: string;
  upload?: string;
  uploadHint?: string;
}
