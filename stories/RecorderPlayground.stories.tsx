import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { DEFAULT_MESSAGES } from '../src/recorder/messages.ts';
import { RecorderPlayground, recordedUpload } from './recorder-playground.tsx';

const meta = {
  title: 'App/Recorder/Playground (end-to-end)',
  component: RecorderPlayground,
  render: (args, context) => <RecorderPlayground key={context.id} {...args} />,
  // Recorder captures the document; keep it out of inline autodocs alongside other mounted stories.
  tags: ['!autodocs'],
  args: {
    uploadMode: 'mock',
    serverUrl: '/api',
    consent: true,
    review: true,
    privacy: 'masked',
    theme: 'dark',
    maxDuration: 180000,
  },
  argTypes: {
    uploadMode: { control: 'inline-radio', options: ['mock', 'server'] },
    privacy: { control: 'inline-radio', options: ['masked', 'visible'] },
    theme: { control: 'inline-radio', options: ['dark', 'light'] },
    maxDuration: { control: { type: 'number', min: 5000, max: 600000, step: 1000 } },
  },
  parameters: {
    layout: 'fullscreen',
    api: { recorderPlayground: true },
    docs: {
      description: {
        component:
          'Real rrweb recording, consent, review, gzip upload and embedded replay. Server mode needs STORYBOOK_REPLAYS_PROXY or a server URL with CORS.',
      },
    },
  },
} satisfies Meta<typeof RecorderPlayground>;
export default meta;
type Story = StoryObj<typeof meta>;

const fullFlow: NonNullable<Story['play']> = async ({ canvasElement, args }) => {
  // Server mode is an explicit manual action: this test only uploads to the in-memory transport.
  if (args.uploadMode === 'server') return;
  const canvas = within(canvasElement);
  const ui = () => {
    const roots = [...canvasElement.ownerDocument.querySelectorAll<HTMLElement>('[data-recorder-ui]')]
      .map((element) => element.shadowRoot)
      .filter((root) => root !== null);
    const root = roots.find((item) => item.querySelector('[role="dialog"]')) ?? roots.at(-1);
    if (!root) throw new Error('Recorder UI has not mounted');
    const surface = root.querySelector<HTMLElement>('dialog, [role="dialog"], .pill');
    if (!surface) throw new Error('Recorder UI surface has not mounted');
    return {
      button: (name: string) => {
        const button = [...surface.querySelectorAll<HTMLButtonElement>('button')].find(
          (item) => item.textContent?.trim() === name || item.getAttribute('aria-label') === name || item.title === name,
        );
        if (!button) throw new Error(`Recorder button not mounted: ${name}`);
        return button;
      },
      note: () => {
        const note = surface.querySelector<HTMLTextAreaElement>('#recorder-note');
        if (!note) throw new Error('Review note has not mounted');
        return note;
      },
    };
  };
  await userEvent.click(canvas.getByRole('button', { name: 'Record' }));
  if (args.consent) {
    await waitFor(() => expect(ui().button(DEFAULT_MESSAGES.consentAccept)).toBeVisible());
    await userEvent.click(ui().button(DEFAULT_MESSAGES.consentAccept));
  }
  await waitFor(() => expect(canvas.getByTestId('recorder-status')).toHaveTextContent('recording'), { timeout: 15000 });
  const privateValue = 'private-fixture-7362';
  const password = 'password-fixture-9047';
  await userEvent.type(canvas.getByLabelText('Customer name'), privateValue);
  await userEvent.type(canvas.getByLabelText('Account password'), password);
  await userEvent.type(canvas.getByLabelText('Delivery instructions'), 'Leave by the blue door');
  await userEvent.click(canvas.getByRole('button', { name: 'Save delivery' }));
  await userEvent.click(canvas.getByRole('button', { name: 'Trigger console error' }));
  await userEvent.click(canvas.getByRole('button', { name: 'Fetch failed checkout' }));
  await waitFor(() => expect(canvas.getByTestId('request-status')).toHaveTextContent('Request failed (500)'));
  await userEvent.click(ui().button(DEFAULT_MESSAGES.stop));
  if (args.review) {
    await waitFor(() => expect(ui().note()).toBeVisible());
    await userEvent.type(ui().note(), 'The checkout failed after saving delivery details.');
    await userEvent.click(ui().button(DEFAULT_MESSAGES.send));
  }
  await waitFor(() => expect(canvas.getByTestId('recording-receipt')).toBeVisible(), {
    timeout: 15000,
  });
  const upload = recordedUpload(canvasElement.querySelector<HTMLElement>('[data-playground-root]')!)!;
  await expect(upload.receipt.replayId).toMatch(/^[a-z0-9][a-z0-9-]{0,79}$/);
  await expect(upload.report.bundle.events.length).toBeGreaterThan(5);
  await expect(upload.report.bundle.meta.eventCount).toBe(upload.report.bundle.events.length);
  await expect(upload.compressed.byteLength).toBeGreaterThan(0);
  const decompressed = await new Response(new Response(upload.compressed).body!.pipeThrough(new DecompressionStream('gzip'))).text();
  await expect(decompressed).toBe(JSON.stringify(upload.report.bundle));
  await expect(decompressed).not.toContain(password);
  if (args.privacy === 'masked') await expect(decompressed).not.toContain(privateValue);
  else await expect(decompressed).toContain(privateValue);
  await expect(
    upload.report.bundle.console.some((entry) => entry.level === 'error' && entry.message.includes('STORYBOOK_CHECKOUT_ERROR')),
  ).toBe(true);
  await expect(upload.report.bundle.network.some((entry) => entry.url.includes('storybook-checkout-failure') && entry.status === 500)).toBe(
    true,
  );
  if (args.review) await expect(upload.report.note).toContain('checkout failed');
  await expect(canvas.getByRole('heading', { name: 'Recording received' })).toBeVisible();
};
export const Manual: Story = {};
export const Guided: Story = { play: fullFlow };
export const OneClick: Story = { args: { consent: false, review: false }, play: fullFlow };
export const VisibleContent: Story = { args: { privacy: 'visible' }, play: fullFlow };
export const Light: Story = {
  args: { theme: 'light' },
  globals: { theme: 'light' },
  play: fullFlow,
};
export const Mobile: Story = {
  globals: { viewport: { value: 'mobile390', isRotated: false } },
  play: fullFlow,
};
export const ServerUpload: Story = {
  args: { uploadMode: 'server' },
  tags: ['!test'],
  parameters: {
    docs: {
      description: {
        story: 'Manual server integration: set the API URL, then record and send. Automated tests always use mock upload.',
      },
    },
  },
};
