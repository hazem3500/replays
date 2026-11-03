import { Progress as ProgressPrimitive } from '@base-ui/react/progress';
import { useProgressValueMotion } from '../../hooks/use-loading-progress-motion.ts';
import { cn } from '@/lib/utils.ts';

function Progress({ className, children, value, min = 0, max = 100, ...props }: ProgressPrimitive.Root.Props) {
  return (
    <ProgressPrimitive.Root
      value={value}
      min={min}
      max={max}
      data-slot="progress"
      className={cn('flex flex-wrap gap-3', className)}
      {...props}
    >
      {children}
      <ProgressTrack>
        <ProgressIndicator
          motionValue={
            value === null || value === undefined ? undefined : Math.max(0, Math.min(100, ((value - min) / (max - min || 1)) * 100))
          }
        />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  );
}

function ProgressTrack({ className, ...props }: ProgressPrimitive.Track.Props) {
  return (
    <ProgressPrimitive.Track
      className={cn('relative flex h-1 w-full items-center overflow-x-hidden rounded-md bg-muted', className)}
      data-slot="progress-track"
      {...props}
    />
  );
}

function ProgressIndicator({
  className,
  motionValue,
  ref,
  ...props
}: ProgressPrimitive.Indicator.Props & { motionValue?: number | undefined }) {
  const motionRef = useProgressValueMotion(motionValue);
  return (
    <ProgressPrimitive.Indicator
      ref={(element) => {
        motionRef.current = element;
        if (typeof ref === 'function') return ref(element);
        if (ref) ref.current = element;
      }}
      data-slot="progress-indicator"
      className={cn('h-full bg-primary', className)}
      {...props}
    />
  );
}

function ProgressLabel({ className, ...props }: ProgressPrimitive.Label.Props) {
  return <ProgressPrimitive.Label className={cn('text-xs/relaxed font-medium', className)} data-slot="progress-label" {...props} />;
}

function ProgressValue({ className, ...props }: ProgressPrimitive.Value.Props) {
  return (
    <ProgressPrimitive.Value
      className={cn('ml-auto text-xs/relaxed text-muted-foreground tabular-nums', className)}
      data-slot="progress-value"
      {...props}
    />
  );
}

export { Progress, ProgressTrack, ProgressIndicator, ProgressLabel, ProgressValue };
