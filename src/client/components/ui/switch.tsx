import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { cn } from '@/lib/utils.ts';

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root data-slot="switch" className={cn('ui-switch', className)} {...props}>
      <SwitchPrimitive.Thumb data-slot="switch-thumb" className="ui-switch-thumb" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
