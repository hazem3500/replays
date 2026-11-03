import { useRef } from 'react';

import { RadioCard, RadioGroup } from '@/components/ui/radio-group.tsx';
import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack } from '@/components/ui/slider.tsx';
import { MAX_ZOOM_SCALE, MIN_ZOOM_SCALE, SPEED_RATES, ZOOM_SCALES } from '../../shared/effects.ts';
import { InspectorSection } from './InspectorParts.tsx';

export const ZOOM_STEP = 0.1;
/** Shift plus an arrow, Page Up and Page Down move the zoom this far. */
export const ZOOM_LARGE_STEP = 0.5;

/** Two decimals, the precision edits store (src/shared/edits.ts), without float noise like 1.2000000000000002. */
const tidy = (value: number) => Math.round(value * 100) / 100;
const zoomText = (value: number) => `${tidy(value)}×`;
const percentOf = (value: number) => ((value - MIN_ZOOM_SCALE) / (MAX_ZOOM_SCALE - MIN_ZOOM_SCALE)) * 100;

/**
 * The zoom level: a continuous slider with its value on the label row and the familiar levels as quick marks under
 * the track. Each value previews at once; one drag (or one key press) is one undo step, because every value after the
 * first of a pointer gesture is merged into it (`onChange`'s `merge`).
 */
export function ZoomLevel({ value, onChange }: { value: number; onChange: (value: number, merge: boolean) => void }) {
  const gesture = useRef(false);
  return (
    <InspectorSection label="Zoom level" labelId="inspector-zoom-label" value={zoomText(value)}>
      <Slider
        className="inspector-slider"
        value={value}
        min={MIN_ZOOM_SCALE}
        max={MAX_ZOOM_SCALE}
        step={ZOOM_STEP}
        largeStep={ZOOM_LARGE_STEP}
        data-testid="zoom-setting"
        onPointerDownCapture={() => {
          gesture.current = false;
        }}
        onKeyDownCapture={() => {
          gesture.current = false;
        }}
        onValueChange={(next) => {
          if (typeof next !== 'number') return;
          const merge = gesture.current;
          gesture.current = true;
          onChange(tidy(next), merge);
        }}
      >
        <SliderControl>
          <SliderTrack>
            <SliderIndicator />
            <SliderThumb aria-labelledby="inspector-zoom-label" getAriaValueText={(next) => `${tidy(Number(next))} times`} />
          </SliderTrack>
        </SliderControl>
      </Slider>
      <div className="inspector-marks">
        {ZOOM_SCALES.map((mark) => (
          <button
            key={mark}
            type="button"
            className="inspector-mark"
            style={{ left: `${percentOf(mark)}%` }}
            aria-label={`Set zoom to ${mark}×`}
            aria-pressed={tidy(value) === mark}
            onClick={() => onChange(mark, false)}
          >
            {mark}×
          </button>
        ))}
      </div>
    </InspectorSection>
  );
}

/** "3.0 s plays in 0.8 s": what a rate does to this stretch, in the reader's terms. */
function speedHint(length: number | undefined, rate: number) {
  if (length === undefined || length <= 0) return;
  return `${(length / 1000).toFixed(1)} s plays in ${(length / rate / 1000).toFixed(1)} s`;
}

/**
 * A speed-up's rate. The rates are a fixed set (each must also be a player speed for the live preview), so every
 * choice stays visible, with what the current one does to this stretch spelled out under it.
 */
export function SpeedChoice({ value, length, onChange }: { value: number; length: number | undefined; onChange: (rate: number) => void }) {
  return (
    <InspectorSection label="Rate" labelId="inspector-speed-label" value={`${value}×`} hint={speedHint(length, value)}>
      <RadioGroup
        className="ui-segmented"
        value={value}
        aria-labelledby="inspector-speed-label"
        data-testid="speed-setting"
        onValueChange={(next) => onChange(Number(next))}
      >
        {SPEED_RATES.map((rate) => (
          <RadioCard key={rate} value={rate} className="ui-segment" aria-label={`${rate}× faster`}>
            {rate}×
          </RadioCard>
        ))}
      </RadioGroup>
    </InspectorSection>
  );
}
