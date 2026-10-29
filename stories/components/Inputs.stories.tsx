import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Input } from '../../src/client/components/ui/input.tsx';
import { Kbd, KbdGroup } from '../../src/client/components/ui/kbd.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../src/client/components/ui/select.tsx';
import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack } from '../../src/client/components/ui/slider.tsx';
import { Switch } from '../../src/client/components/ui/switch.tsx';
import { settled } from '../play.ts';

const meta = { title: 'Components/Inputs', parameters: { layout: 'padded' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const field = 'grid gap-1.5 text-xs text-muted-foreground';

const FIELDS = [
  { id: 'title', label: 'Replay title', props: { defaultValue: 'Checkout fails after saving the address' } },
  { id: 'search', label: 'Search', props: { placeholder: 'Search replays' } },
  { id: 'invalid', label: 'Invalid', props: { 'aria-invalid': true, defaultValue: 'not a url' } },
  { id: 'disabled', label: 'Disabled', props: { disabled: true, defaultValue: 'Read only' } },
] as const;

export const TextInput: Story = {
  render: () => (
    <div className="sb-stack">
      {FIELDS.map(({ id, label, props }) => (
        <div key={id} className={field}>
          <label htmlFor={`input-${id}`}>{label}</label>
          <Input id={`input-${id}`} {...props} />
        </div>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const search = within(canvasElement).getByLabelText('Search');
    await userEvent.type(search, 'checkout');
    await expect(search).toHaveValue('checkout');
  },
};

export const Toggle: Story = {
  render: () => (
    <div className="sb-row text-xs">
      <Switch defaultChecked={false} aria-labelledby="trail-label" />
      <span id="trail-label">Show cursor trail</span>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const toggle = within(canvasElement).getByRole('switch', { name: 'Show cursor trail' });
    await expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await expect(toggle).toBeChecked();
  },
};

export const Range: Story = {
  render: () => (
    <div className="sb-stack">
      <Slider defaultValue={1.5} min={0.25} max={4} step={0.25} aria-label="Playback speed">
        <SliderControl>
          <SliderTrack>
            <SliderIndicator />
            <SliderThumb aria-label="Playback speed" />
          </SliderTrack>
        </SliderControl>
      </Slider>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const thumb = within(canvasElement).getByRole('slider', { name: 'Playback speed' });
    thumb.focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(thumb).toHaveValue('1.75');
  },
};

const SPEEDS = ['0.5×', '1×', '2×'];

export const Choice: Story = {
  render: () => (
    <Select defaultValue="1×">
      <SelectTrigger aria-label="Speed">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SPEEDS.map((speed) => (
          <SelectItem key={speed} value={speed}>
            {speed}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('combobox', { name: 'Speed' });
    await userEvent.click(trigger);
    await userEvent.click(await within(document.body).findByRole('option', { name: '2×' }));
    await waitFor(() => expect(trigger).toHaveTextContent('2×'));
    await waitFor(() => expect(within(document.body).queryByRole('listbox')).toBeNull());
    await settled();
  },
};

export const Shortcuts: Story = {
  render: () => (
    <div className="sb-row text-xs text-muted-foreground">
      <KbdGroup>
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
      Search
      <Kbd>Space</Kbd>
      Play or pause
      <Kbd>?</Kbd>
      All shortcuts
    </div>
  ),
};
