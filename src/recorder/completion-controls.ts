import type { CompletionAction, CompletionContext, ReceiptValue } from './default-ui-types.ts';
import { element, link } from './default-ui-dom.ts';

/** Mounts receipt actions while retaining their host completion context. */
export function appendCompletionControls(
  controls: HTMLElement,
  configuredActions: readonly CompletionAction[] | undefined,
  resolveValue: (value: ReceiptValue) => string,
  copy: (value?: string, control?: HTMLElement) => Promise<void>,
  context: CompletionContext,
  href: string | undefined,
  messages: { openLink: string; copyLink: string },
) {
  const actions: readonly CompletionAction[] =
    configuredActions ??
    (href
      ? [
          { id: 'open', label: messages.openLink, kind: 'link', href, primary: true },
          { id: 'copy-link', label: messages.copyLink, kind: 'copy', value: href },
        ]
      : []);
  for (const action of actions) {
    let control: HTMLElement | undefined;
    const className = action.primary ? 'primary' : '';
    if (action.kind === 'link') control = link(action.label, resolveValue(action.href), className);
    else
      control = element(
        'button',
        {
          type: 'button',
          className,
          onclick: () => {
            if (action.kind === 'copy') void copy(action.value === undefined ? undefined : resolveValue(action.value), control);
            else void action.onAction(context);
          },
        },
        [action.label],
      );
    if (control) {
      control.dataset.action = action.id;
      controls.append(control);
    }
  }
}
