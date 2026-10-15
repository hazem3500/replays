/**
 * The product's name lives here and in README.md (plus package.json's `name`/`bin` and the Dockerfile's image label);
 * rename it by changing these constants. At runtime a deployment can override the display name, logo and colours
 * (PRODUCT_NAME, LOGO_URL and the `theme` block of the config file, see src/server/branding.ts).
 */
export const PRODUCT_NAME = 'replays';
/** Lower-case identifier for CLI help, storage keys, cookie and file names. */
export const PRODUCT_SLUG = 'replays';
