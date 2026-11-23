import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

const badgeClasses = cva("shrink-0 rounded-md px-1.5 text-xs font-normal whitespace-nowrap", {
  variants: {
    variant: {
      neutral: "bg-muted text-muted-foreground",
      success: "bg-emerald-100 text-emerald-800",
      warning: "bg-amber-100 text-amber-800",
    },
  },
  defaultVariants: { variant: "neutral" },
});

/** A short label next to a name, e.g. "archiviert". */
function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeClasses>) {
  return <span data-slot="badge" className={cn(badgeClasses({ variant }), className)} {...props} />;
}

export { Badge };
