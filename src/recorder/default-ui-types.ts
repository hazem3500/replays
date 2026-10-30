import type { RecorderFormat } from './format.ts';
import type { RecorderMessageOverrides } from './messages.ts';
import type { IssueReportReceipt } from './upload.ts';

/** CSS colors/fonts/radii. Omitted values inherit Replays host tokens. */
export type RecorderTheme = Partial<
  Record<
    | 'background'
    | 'foreground'
    | 'secondary'
    | 'border'
    | 'borderStrong'
    | 'hover'
    | 'pressed'
    | 'primary'
    | 'primaryForeground'
    | 'danger'
    | 'font'
    | 'radius',
    string
  >
>;
export type CompletionContext = {
  result: IssueReportReceipt;
  copy(value?: string): Promise<void>;
  retry(): void;
  dismiss(): void;
};
/** What every completion action has. */
type ActionBase = { id: string; label: string; primary?: boolean };
/** A fixed value, or one read from the upload's receipt. */
export type ReceiptValue = string | ((result: IssueReportReceipt) => string);
export type CompletionAction = ActionBase &
  (
    | { kind: 'copy'; value?: ReceiptValue }
    | { kind: 'link'; href: ReceiptValue }
    | { kind: 'custom'; onAction(context: CompletionContext): void | Promise<void> }
  );
export type CompletionOptions = {
  message?: ReceiptValue;
  /** Explicit [] produces a message-only completion. */
  actions?: readonly CompletionAction[];
  /** Own the completion body; return a cleanup for subscriptions/listeners. */
  render?: (container: HTMLElement, context: CompletionContext) => void | (() => void);
};
export type DefaultUiOptions = {
  /** Replace any of `defaultRecorderMessages`; see `RecorderMessages`. */
  messages?: RecorderMessageOverrides;
  /** BCP 47 locale for the default `format` hooks. Default `en`. */
  locale?: string;
  /** Replace how elapsed time, durations and sizes are written. */
  format?: Partial<RecorderFormat>;
  theme?: 'dark' | 'light' | RecorderTheme;
  /** Must reflect capture policy when the host supplies its own UI. */
  privacyMode?: 'masked' | 'visible';
  completion?: CompletionOptions;
  /** Where the UI is mounted. Default `document.body`. */
  container?: () => HTMLElement;
  /** `z-index` of the overlay. Default `2147483000`. */
  zIndex?: number;
};
