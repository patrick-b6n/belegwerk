import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Loader2Icon } from "lucide-react";

const buttonClasses = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-normal whitespace-nowrap transition-all outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-busy:[&>svg:not([data-slot=button-spinner])]:hidden aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-primary border-b-[color-mix(in_oklch,var(--primary),black_25%)] bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 data-disabled:hover:bg-primary data-disabled:active:bg-primary",
        outline:
          "border-border border-b-control-stroke bg-card hover:bg-[color-mix(in_oklch,var(--card),var(--foreground)_3%)] hover:text-foreground active:text-muted-foreground aria-expanded:bg-muted aria-expanded:text-foreground data-disabled:hover:bg-card data-disabled:active:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground data-disabled:hover:bg-transparent",
        // The final, irreversible step (confirmation dialogs).
        destructive:
          "border-destructive border-b-[color-mix(in_oklch,var(--destructive),black_25%)] bg-destructive text-white hover:bg-destructive/90 active:bg-destructive/80 focus-visible:ring-destructive data-disabled:hover:bg-destructive data-disabled:active:bg-destructive",
        // Leads to a confirmation: less prominent than the page's primary action.
        "destructive-outline":
          "border-border border-b-control-stroke bg-card text-destructive hover:bg-destructive/5 focus-visible:ring-destructive aria-expanded:bg-destructive/5 data-disabled:hover:bg-card",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-2 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 rounded-md px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-md px-2.5 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-md in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-md in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonVariants = VariantProps<typeof buttonClasses>;

/** The button's classes for links that look like buttons (merged: the variant wins over the base). */
function buttonVariants(options?: ButtonVariants): string {
  return cn(buttonClasses(options));
}

/**
 * `busy`: the button's action is running. It is disabled but keeps the focus
 * (it would otherwise fall back to the page) and shows a spinner, which takes
 * the place of the button's icon.
 */
function Button({
  className,
  variant = "default",
  size = "default",
  busy = false,
  disabled = false,
  focusableWhenDisabled = false,
  children,
  ...props
}: ButtonPrimitive.Props & ButtonVariants & { busy?: boolean }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      disabled={disabled || busy}
      focusableWhenDisabled={focusableWhenDisabled || busy}
      aria-busy={busy || undefined}
      className={cn(buttonClasses({ variant, size }), className)}
      {...props}
    >
      {busy && <Loader2Icon aria-hidden data-slot="button-spinner" className="animate-spin" />}
      {children}
    </ButtonPrimitive>
  );
}

export { Button, buttonVariants };
