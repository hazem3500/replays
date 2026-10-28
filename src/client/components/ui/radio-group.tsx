import { Radio as RadioPrimitive } from '@base-ui/react/radio';
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group';
import { cn } from '@/lib/utils.ts';

function RadioGroup<Value>({ className, ...props }: RadioGroupPrimitive.Props<Value>) {
  return <RadioGroupPrimitive data-slot="radio-group" className={cn('ui-radio-group', className)} {...props} />;
}

function RadioCard<Value>({ className, ...props }: RadioPrimitive.Root.Props<Value>) {
  return <RadioPrimitive.Root data-slot="radio-card" className={cn('ui-radio-card', className)} {...props} />;
}

export { RadioGroup, RadioCard };
