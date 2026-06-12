import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/app/shared/utils/cn";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-md)] border border-transparent bg-clip-padding text-sm font-medium leading-none whitespace-nowrap text-[var(--text-primary)] transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--t-control)] ease-[var(--ease-control)] outline-none select-none focus-visible:border-[var(--accent-linear)] focus-visible:ring-3 focus-visible:ring-[color-mix(in_srgb,var(--accent-linear)_35%,transparent)] active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--accent-linear)] text-[var(--accent-contrast)] hover:bg-[var(--accent-linear-bright)]",
        outline:
          "border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-secondary)] shadow-[var(--shadow-hairline)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] aria-expanded:bg-[var(--bg-hover)] aria-expanded:text-[var(--text-primary)]",
        secondary:
          "border-[var(--border-subtle)] bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)] aria-expanded:bg-[var(--bg-active)] aria-expanded:text-[var(--text-primary)]",
        ghost:
          "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] aria-expanded:bg-[var(--bg-hover)] aria-expanded:text-[var(--text-primary)]",
        destructive:
          "bg-[color-mix(in_srgb,var(--error-linear)_14%,transparent)] text-[var(--error-linear)] hover:bg-[color-mix(in_srgb,var(--error-linear)_22%,transparent)] focus-visible:border-[var(--error-linear)] focus-visible:ring-[color-mix(in_srgb,var(--error-linear)_24%,transparent)]",
        link: "text-[var(--text-secondary)] underline-offset-4 hover:text-[var(--text-primary)] hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
