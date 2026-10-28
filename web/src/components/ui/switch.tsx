import * as React from "react"
import { cn } from "cn"
import { Switch as SwitchPrimitive } from "radix-ui"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch inline-flex shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-[1.25rem] data-[size=default]:w-[2.1rem] data-[size=sm]:h-3.5 data-[size=sm]:w-6 data-[state=checked]:bg-brand data-[state=unchecked]:bg-well2 data-[state=unchecked]:shadow-[inset_0_0_0_1px_var(--line2)]",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-surface shadow-[0_1px_2px_rgba(0,0,0,.2)] ring-0 transition-transform duration-200 ease-[cubic-bezier(.2,.8,.2,1)] group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-[state=checked]:translate-x-[calc(100%+0px)] data-[state=unchecked]:translate-x-[2px] dark:data-[state=checked]:bg-on-brand"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
