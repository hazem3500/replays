import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Input } from '../src/client/components/ui/input.tsx';
import { Switch } from '../src/client/components/ui/switch.tsx';
import { Pressable } from '../src/client/components/ui/pressable.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../src/client/components/ui/select.tsx';
import { Slider, SliderControl, SliderTrack, SliderIndicator, SliderThumb } from '../src/client/components/ui/slider.tsx';
import { Progress, ProgressTrack, ProgressIndicator, ProgressLabel, ProgressValue } from '../src/client/components/ui/progress.tsx';
import { Badge } from '../src/client/components/ui/badge.tsx';
import { Kbd, KbdGroup } from '../src/client/components/ui/kbd.tsx';
import { Separator } from '../src/client/components/ui/separator.tsx';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../src/client/components/ui/tabs.tsx';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../src/client/components/ui/collapsible.tsx';
const meta = {
  title: 'Components/Controls',
  decorators: [
    (Story) => (
      <div className="sb-stage">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
function SwitchDemo({ disabled = false, checked = false }: { disabled?: boolean; checked?: boolean }) {
  const [on, setOn] = useState(checked);
  return (
    <label htmlFor="skip-inactive" className="sb-stack">
      <Switch id="skip-inactive" checked={on} disabled={disabled} onCheckedChange={setOn} />
      Skip inactive time
    </label>
  );
}
export const SwitchOff: Story = {
  render: () => <SwitchDemo />,
  play: async ({ canvasElement }) => {
    const control = within(canvasElement).getByRole('switch');
    await expect(control).not.toBeChecked();
    await userEvent.click(control);
    await expect(control).toBeChecked();
  },
};
export const SwitchOn: Story = { render: () => <SwitchDemo checked /> };
export const SwitchDisabled: Story = { render: () => <SwitchDemo disabled /> };
export const TextInput: Story = {
  render: () => (
    <label htmlFor="replay-title">
      Replay title
      <Input id="replay-title" placeholder="Checkout investigation" />
    </label>
  ),
};
export const FilledInput: Story = {
  render: () => <Input aria-label="Replay title" defaultValue="Checkout investigation" />,
};
export const InvalidInput: Story = {
  render: () => (
    <label htmlFor="invalid-title">
      Replay title
      <Input id="invalid-title" aria-invalid aria-describedby="title-error" />
      <span id="title-error">A title is required.</span>
    </label>
  ),
};
export const DisabledInput: Story = {
  render: () => <Input aria-label="Replay title" defaultValue="Read only recording" disabled />,
};
export const LongInput: Story = {
  render: () => <Input aria-label="Replay title" defaultValue={'Checkout regression with a long customer journey · '.repeat(8)} />,
};
export const SelectSpeed: Story = {
  render: () => (
    <Select defaultValue="1">
      <SelectTrigger aria-label="Playback speed">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {['0.5', '1', '1.5', '2', '4'].map((speed) => (
          <SelectItem key={speed} value={speed}>
            {speed}×
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
};
export const SliderVolume: Story = {
  render: () => (
    <Slider aria-label="Volume" defaultValue={50} style={{ width: 260 }}>
      <SliderControl>
        <SliderTrack>
          <SliderIndicator />
        </SliderTrack>
        <SliderThumb aria-label="Volume" />
      </SliderControl>
    </Slider>
  ),
};
export const SliderDisabled: Story = {
  render: () => (
    <Slider aria-label="Volume" defaultValue={50} disabled>
      <SliderControl>
        <SliderTrack>
          <SliderIndicator />
        </SliderTrack>
        <SliderThumb aria-label="Volume" />
      </SliderControl>
    </Slider>
  ),
};
export const ProgressLoading: Story = {
  render: () => (
    <Progress value={42}>
      <ProgressLabel>Uploading recording</ProgressLabel>
      <ProgressValue />
      <ProgressTrack>
        <ProgressIndicator />
      </ProgressTrack>
    </Progress>
  ),
};
export const ProgressComplete: Story = {
  render: () => (
    <Progress value={100}>
      <ProgressLabel>Upload complete</ProgressLabel>
      <ProgressTrack>
        <ProgressIndicator />
      </ProgressTrack>
    </Progress>
  ),
};
export const ProgressIndeterminate: Story = {
  render: () => (
    <Progress value={null}>
      <ProgressLabel>Preparing recording</ProgressLabel>
      <ProgressTrack>
        <ProgressIndicator />
      </ProgressTrack>
    </Progress>
  ),
};
export const Badges: Story = {
  render: () => (
    <div className="sb-stack">
      {(['default', 'secondary', 'destructive', 'outline'] as const).map((variant) => (
        <Badge key={variant} variant={variant}>
          {variant}
        </Badge>
      ))}
    </div>
  ),
};
export const KeyboardShortcuts: Story = {
  render: () => (
    <KbdGroup>
      <Kbd>⌘</Kbd>
      <Kbd>K</Kbd>
    </KbdGroup>
  ),
};
export const Separators: Story = {
  render: () => (
    <div>
      <p>Playback</p>
      <Separator />
      <p>Inspector</p>
    </div>
  ),
};
export const TabsNavigation: Story = {
  render: () => (
    <Tabs defaultValue="console">
      <TabsList>
        <TabsTrigger value="console">Console</TabsTrigger>
        <TabsTrigger value="network">Network</TabsTrigger>
        <TabsTrigger value="context" disabled>
          Context
        </TabsTrigger>
      </TabsList>
      <TabsContent value="console">Console messages</TabsContent>
      <TabsContent value="network">Network requests</TabsContent>
    </Tabs>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('tab', { name: 'Network' }));
    await expect(canvas.getByText('Network requests')).toBeVisible();
  },
};
export const CollapsibleDetails: Story = {
  render: () => (
    <Collapsible>
      <CollapsibleTrigger>Request details</CollapsibleTrigger>
      <CollapsibleContent>POST /checkout · 500 Internal Server Error</CollapsibleContent>
    </Collapsible>
  ),
};
function PressableDemo() {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable pressed={pressed} onPressedChange={setPressed}>
      Show captions
    </Pressable>
  );
}
export const ToggleButton: Story = { render: () => <PressableDemo /> };
