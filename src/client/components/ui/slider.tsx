import { SliderMotion } from './control-motion.tsx';
import { Slider as SliderPrimitive } from '@base-ui/react/slider';
import { cn } from '@/lib/utils.ts';

function Slider<Value extends number | readonly number[]>({ className, ...props }: SliderPrimitive.Root.Props<Value>) {
  return <SliderPrimitive.Root data-slot="slider" className={cn('ui-slider', className)} {...props} />;
}

function SliderControl({ className, ...props }: SliderPrimitive.Control.Props) {
  return <SliderPrimitive.Control data-slot="slider-control" className={cn('ui-slider-control', className)} {...props} />;
}

function SliderTrack({ className, ...props }: SliderPrimitive.Track.Props) {
  return <SliderPrimitive.Track data-slot="slider-track" className={cn('ui-slider-track', className)} {...props} />;
}

function SliderIndicator({ className, ...props }: SliderPrimitive.Indicator.Props) {
  return (
    <SliderPrimitive.Indicator
      render={(dom) => <SliderMotion {...dom} kind="indicator" />}
      data-slot="slider-indicator"
      className={cn('ui-slider-indicator', className)}
      {...props}
    />
  );
}

function SliderThumb({ className, ...props }: SliderPrimitive.Thumb.Props) {
  return (
    <SliderPrimitive.Thumb
      render={(dom) => <SliderMotion {...dom} kind="thumb" />}
      data-slot="slider-thumb"
      className={cn('ui-slider-thumb', className)}
      {...props}
    />
  );
}

export { Slider, SliderControl, SliderTrack, SliderIndicator, SliderThumb };
