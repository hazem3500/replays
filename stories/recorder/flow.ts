import { expect, userEvent, waitFor, within } from 'storybook/test';
import { DEFAULT_MESSAGES } from '../../src/recorder/index.ts';
import type { UploadEndpoint } from './upload-endpoint.ts';

export const PRIVATE_NAME = 'Ada Private 7362';
export const PASSWORD = 'hunter2-9047';
export const NOTE = 'Checkout failed after I saved the delivery note.';

const roots = () => [...document.querySelectorAll('[data-recorder-ui]')].flatMap((host) => (host.shadowRoot ? [host.shadowRoot] : []));
const all = <T extends Element = Element>(selector: string) => roots().flatMap((root) => [...root.querySelectorAll<T>(selector)]);
const named = (element: Element) => (element.getAttribute('aria-label') ?? element.textContent ?? '').trim();
// why: an element hidden by display:none, [hidden] or a closed dialog has no layout boxes.
const shown = <T extends Element>(element: T | undefined) => (element && element.getClientRects().length > 0 ? element : undefined);

/**
 * The default UI renders into open shadow roots on `document.body`, one per surface, outside the story canvas and out of
 * reach of Testing Library. These lookups return only visible elements.
 */
export const recorderUi = {
  button: (name: string) => shown(all<HTMLButtonElement>('button').find((button) => named(button) === name)),
  link: (name: string) => shown(all<HTMLAnchorElement>('a').find((link) => named(link) === name)),
  heading: (name: string) => shown(all('h2').find((heading) => named(heading) === name)),
  text: (text: string) =>
    shown(
      all('p, span, strong, div')
        .filter((element) => element.textContent?.includes(text))
        .at(-1),
    ),
  note: () => shown(all<HTMLTextAreaElement>('textarea')[0]),
};

/** Waits until the recorder UI shows `find`'s element and returns it. */
export async function inRecorderUi<T extends Element>(find: () => T | undefined): Promise<T> {
  let found: T | undefined;
  await waitFor(
    () => {
      found = find();
      if (!found) throw new Error('Not shown in the recorder UI yet');
    },
    { timeout: 10_000 },
  );
  if (!found) throw new Error('Not shown in the recorder UI');
  return found;
}

const uiButton = (name: string) => inRecorderUi(() => recorderUi.button(name));

export async function expectStatus(canvasElement: HTMLElement, status: string) {
  const badge = within(canvasElement).getByTestId('recorder-status');
  await waitFor(() => expect(badge).toHaveTextContent(status), { timeout: 15_000 });
}

export async function startRecording(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'Report a problem' }));
  await userEvent.click(await uiButton(DEFAULT_MESSAGES.consentAccept));
  await expectStatus(canvasElement, 'recording');
}

export async function fillCheckout(canvasElement: HTMLElement) {
  const page = within(canvasElement);
  await userEvent.type(page.getByLabelText('Full name'), PRIVATE_NAME);
  await userEvent.type(page.getByLabelText('Account password'), PASSWORD);
  await userEvent.click(page.getByRole('button', { name: 'Place order' }));
  await waitFor(() => expect(page.getByRole('status')).toHaveTextContent('Order failed (500)'));
}

export async function stopAndReview(canvasElement: HTMLElement) {
  await userEvent.click(await uiButton(DEFAULT_MESSAGES.stop));
  await expectStatus(canvasElement, 'review');
  await inRecorderUi(() => recorderUi.heading(DEFAULT_MESSAGES.reviewTitle));
}

export async function send() {
  await userEvent.type(await inRecorderUi(recorderUi.note), NOTE);
  await userEvent.click(await uiButton(DEFAULT_MESSAGES.send));
}

/** Everything the endpoint received is what a real server would store; check it, not the recorder's memory. */
export async function expectDelivered(endpoint: UploadEndpoint) {
  await waitFor(() => expect(endpoint.uploads()).toHaveLength(1), { timeout: 15_000 });
  const [upload] = endpoint.uploads();
  if (!upload) throw new Error('No upload arrived');
  const { bundle, note } = upload.report;
  await expect(upload.contentEncoding).toBe('gzip');
  await expect(note).toBe(NOTE);
  await expect(bundle.events.length).toBeGreaterThan(5);
  await expect(upload.body).not.toContain(PASSWORD);
  await expect(upload.body).not.toContain(PRIVATE_NAME);
  await expect(bundle.network.some((entry) => entry.url.endsWith('/demo-shop/checkout') && entry.status === 500)).toBe(true);
  await expect(bundle.console.some((entry) => entry.level === 'error' && entry.message.includes('Checkout failed'))).toBe(true);
}
