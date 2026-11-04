import type { PluginRegistry } from '../../plugin/registry.ts';
import type { HostVersions, MalleablePolicy } from '../../shared/malleable-policy.ts';
import type { RedactionRules } from '../../shared/redaction.ts';
import type { ReplayBundle } from '../../shared/replay.ts';
import type { SignInConfig } from '../../shared/sign-in.ts';
import type { SourceProviders } from '../../shared/source-providers.ts';
import type { HookRequests } from '../plugin-runtime.ts';
import type { AuthAdapter, Identity } from '../auth/types.ts';
import type { BetaFlags } from '../beta.ts';
import type { BrandingConfig } from '../branding.ts';
import type { ContextSchema } from '../context-schema.ts';
import type { ViewCatalog } from '../views.ts';
import type { ReplayStore } from '../store.ts';

/** The parts of the deployment the API routes read: only these, so the routes stay mountable without the Node app. */
export interface ApiDeployment {
  store: ReplayStore;
  auth: Pick<AuthAdapter, 'name' | 'cliDeviceAuth' | 'signOutUrl'>;
  sources: SourceProviders;
  views: ViewCatalog;
  branding: BrandingConfig;
  contextSchema?: ContextSchema | undefined;
  beta?: BetaFlags | undefined;
  publicOrigin?: string | undefined;
  /** List posters (posters.ts); absent when posters are off. */
  posters?: { request(id: string, kind: 'poster' | 'preview'): Promise<unknown> } | undefined;
}

/** What the API routes share for the app's lifetime; built once by `createApp`. Framework-free: no request in here. */
export interface ApiServices {
  /** Per-replay visibility for trash listings; absent means no trash IDs may be disclosed. */
  canReadReplay?: (hooks: HookRequests, identity: Identity, id: string, base: string) => Promise<boolean>;
  /** Per-item DELETE authorization for bulk trash; absent disables bulk deletion and its eligible count. */
  canDeleteReplay?: (hooks: HookRequests, identity: Identity, id: string, base: string) => Promise<boolean>;
  deployment: ApiDeployment;
  registry: PluginRegistry;
  redaction: RedactionRules;
  /**
   * The server's privacy pass over an upload (defaults plus the host's rules), in its own span. `upload.staff` (see
   * `isStaffUpload`) lets a host that opted in keep a bundle's declared visible inputs; without it every input is masked.
   * Any `upload` lets a host with `privacy.keepCustomerChoices` keep a customer's matching choice; an import passes none.
   */
  sanitize: (bundle: ReplayBundle, upload?: { staff: boolean }) => ReplayBundle;
  signIn: SignInConfig | undefined;
  editing: { enabled: boolean };
  commentsOn: boolean;
  policy: MalleablePolicy;
  versions: HostVersions;
  /** Some profile can be inferred, so a served bundle may carry `x-replay-profile`. */
  inferable: boolean;
}
