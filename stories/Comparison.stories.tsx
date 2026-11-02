import type { Meta, StoryObj } from '@storybook/react-vite';
import { ComparisonWorkspace } from '../src/client/comparison/ComparisonWorkspace.tsx';
import { ComparisonLoading } from '../src/client/comparison/ComparisonLoading.tsx';
import { samples } from './fixtures/replays.ts';
const meta = {
  title: 'App/Comparison/Workspace',
  parameters: { layout: 'fullscreen' },
  component: ComparisonWorkspace,
  args: { beforeId: samples[0]!.meta.id, afterId: samples[4]!.meta.id },
} satisfies Meta<typeof ComparisonWorkspace>;
export default meta;
type Story = StoryObj<typeof meta>;
export const BeforeAndAfter: Story = {};
export const Loading: Story = { parameters: { api: { state: 'loading' } } };
export const LoadingShell: Story = { render: () => <ComparisonLoading /> };
export const Error: Story = { parameters: { api: { state: 'error' } } };
export const NoDiagnostics: Story = { parameters: { api: { state: 'empty' } } };
export const Mobile: Story = { globals: { viewport: { value: 'mobile390', isRotated: false } } };
export const Light: Story = { globals: { theme: 'light' } };
