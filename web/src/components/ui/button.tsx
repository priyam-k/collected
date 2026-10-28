import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-sm font-[560] tracking-[-0.005em] whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-150 ease-[cubic-bezier(.2,.8,.2,1)] outline-none active:scale-[.98] focus-visible:shadow-[var(--focus-ring)] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-brand text-on-brand hover:bg-[color-mix(in_srgb,var(--brand)_88%,var(--ink))]",
        destructive:
          "bg-critical text-on-brand hover:bg-[color-mix(in_srgb,var(--critical)_88%,var(--ink))]",
        outline:
          "bg-surface text-foreground shadow-[var(--shadow-card),inset_0_0_0_1px_var(--line)] hover:bg-surface-hover",
        secondary:
          "bg-well text-ink hover:bg-well2",
        ghost:
          "text-sub hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-ink",
        link: "text-brand-ink underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 text-[13px] has-[>svg]:px-3",
        xs: "h-7 gap-1 px-3 text-xs has-[>svg]:px-2.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3.5 text-[12.5px] has-[>svg]:px-3",
        lg: "h-10 px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
