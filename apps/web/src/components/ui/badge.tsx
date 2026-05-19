
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none transition-colors overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[var(--bg-tertiary)] text-[var(--text-primary)]",
        secondary:
          "border-transparent bg-[var(--bg-secondary)] text-[var(--text-secondary)]",
        success:
          "border-transparent bg-[rgba(63,185,80,0.2)] text-[var(--accent-green)]",
        error:
          "border-transparent bg-[rgba(248,81,73,0.2)] text-[var(--accent-red)]",
        warning:
          "border-transparent bg-[rgba(210,153,34,0.2)] text-[var(--accent-yellow)]",
        info:
          "border-transparent bg-[rgba(88,166,255,0.2)] text-[var(--accent-blue)]",
        purple:
          "border-transparent bg-[rgba(163,113,247,0.2)] text-[var(--accent-purple)]",
        outline:
          "border-[var(--border-color)] text-[var(--text-secondary)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
