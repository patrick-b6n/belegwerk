import { cn } from "cn";
import { InfoIcon, type LucideIcon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";

type NoticeVariant = "info" | "warning" | "error";

const VARIANTS: Readonly<Record<NoticeVariant, { icon: LucideIcon; box: string; mark: string }>> = {
  info: { icon: InfoIcon, box: "border-sky-200 bg-sky-50", mark: "text-sky-700" },
  warning: { icon: TriangleAlertIcon, box: "border-amber-300 bg-amber-50", mark: "text-amber-700" },
  error: {
    icon: OctagonXIcon,
    box: "border-destructive/40 bg-destructive/5",
    mark: "text-destructive",
  },
};

/**
 * A message box in the page (like a Windows InfoBar): hints, warnings and
 * errors that do not belong to one field. The icon is decorative; the text
 * has to say what is wrong. Errors that appear after an action also need
 * `role="alert"`.
 */
function Notice({
  className,
  variant = "info",
  children,
  ...props
}: React.ComponentProps<"div"> & { variant?: NoticeVariant }) {
  const { icon: Icon, box, mark } = VARIANTS[variant];
  return (
    <div
      data-slot="notice"
      className={cn(
        "flex items-start gap-2.5 rounded-xl border p-3 text-sm text-foreground outline-none",
        box,
        className,
      )}
      {...props}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", mark)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
    </div>
  );
}

export { Notice };
