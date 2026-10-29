import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { expect, userEvent, waitFor } from 'storybook/test';
import { DEFAULT_MESSAGES } from '../../src/recorder/index.ts';
import { CHECKOUT_PATH } from './DemoShop.tsx';
import { RecorderWorkbench } from './RecorderWorkbench.tsx';
import { expectDelivered, expectStatus, fillCheckout, inRecorderUi, recorderUi, send, startRecording, stopAndReview } from './flow.ts';
import { createUploadEndpoint } from './upload-endpoint.ts';

const endpoint = createUploadEndpoint('accept');
const checkoutFails = http.post(`*${CHECKOUT_PATH}`, () => HttpResponse.json({ error: 'Payment service unavailable' }, { status: 500 }));

const meta = {
  title: 'Recorder/End to end',
  component: RecorderWorkbench,
  // why: a recorder captures the whole document, so each story gets a fresh one and the docs page renders none inline.
  render: (args, context) => <RecorderWorkbench key={`${context.id}:${JSON.stringify({ ...args, endpoint: undefined })}`} {...args} />,
  tags: ['!autodocs'],
  args: { endpoint, transport: 'http', theme: 'dark', privacy: 'masked', consent: true, review: true },
  argTypes: {
    endpoint: { table: { disable: true } },
    transport: { control: 'inline-radio', options: ['http', 'token'] },
    theme: { control: 'inline-radio', options: ['dark', 'light'] },
    privacy: { control: 'inline-radio', options: ['masked', 'visible'] },
  },
  parameters: {
    network: { handlers: [endpoint.handler, checkoutFails] },
    docs: {
      description: {
        component:
          'The production recorder and default UI on a demo checkout. Uploads leave the page over the network and a Mock Service Worker answers as the ingest endpoint, so the inspector shows exactly what a server would receive.',
      },
    },
  },
  beforeEach: () => endpoint.reset(),
} satisfies Meta<typeof RecorderWorkbench>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Record, review and send by hand. Switch the endpoint between accept, hold and 503 in the inspector. */
export const Playground: Story = {};

const recordAndUpload: NonNullable<Story['play']> = async ({ canvasElement, step }) => {
  await step('Consent and record', () => startRecording(canvasElement));
  await step('Use the page', () => fillCheckout(canvasElement));
  await step('Stop and review', () => stopAndReview(canvasElement));
  await step('Send', send);
  await step('The endpoint received a masked, gzipped replay', () => expectDelivered(endpoint));
  await expectStatus(canvasElement, 'uploaded');
  await inRecorderUi(() => recorderUi.text(DEFAULT_MESSAGES.sent));
};

export const RecordAndUpload: Story = { play: recordAndUpload };

export const Review: Story = {
  play: async ({ canvasElement }) => {
    await startRecording(canvasElement);
    await fillCheckout(canvasElement);
    await stopAndReview(canvasElement);
    await inRecorderUi(() => recorderUi.button(DEFAULT_MESSAGES.discard));
  },
};

export const Uploading: Story = {
  beforeEach: () => endpoint.setMode('hold'),
  play: async ({ canvasElement }) => {
    await startRecording(canvasElement);
    await stopAndReview(canvasElement);
    await send();
    await expectStatus(canvasElement, 'uploading');
    await waitFor(() => expect(endpoint.uploads()).toHaveLength(1));
    await inRecorderUi(() => recorderUi.text(DEFAULT_MESSAGES.uploading));
  },
};

/**
 * `createTokenUpload` posts with XHR and reports byte progress on a real network. A service worker answers before
 * Chromium emits upload progress events, so this mock shows the indeterminate state; Recorder/Custom UI (kit) shows the
 * progress surface.
 */
export const TokenUpload: Story = {
  args: { transport: 'token' },
  beforeEach: () => endpoint.setMode('hold'),
  play: async ({ canvasElement }) => {
    await startRecording(canvasElement);
    await stopAndReview(canvasElement);
    await send();
    await expectStatus(canvasElement, 'uploading');
    await waitFor(() => expect(endpoint.uploads()[0]?.authorization).toBe('Bearer storybook-upload-token'));
    await expect(endpoint.uploads()[0]?.contentEncoding).toBe('gzip');
  },
};

export const UploadFailsThenRetries: Story = {
  beforeEach: () => endpoint.setMode('unavailable'),
  play: async ({ canvasElement, step }) => {
    await startRecording(canvasElement);
    await stopAndReview(canvasElement);
    await send();
    await step('The endpoint answers 503', async () => {
      await expectStatus(canvasElement, 'error');
      await inRecorderUi(() => recorderUi.text(DEFAULT_MESSAGES.failed));
    });
    await step('Retry succeeds once the endpoint recovers', async () => {
      endpoint.setMode('accept');
      await userEvent.click(await inRecorderUi(() => recorderUi.button(DEFAULT_MESSAGES.retry)));
      await expectStatus(canvasElement, 'uploaded');
      await waitFor(() => expect(endpoint.uploads()).toHaveLength(2));
    });
  },
};

export const LightPhone: Story = {
  args: { theme: 'light' },
  globals: { theme: 'light', viewport: { value: 'phone', isRotated: false } },
  play: recordAndUpload,
};
