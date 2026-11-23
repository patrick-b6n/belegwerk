import { m } from "@/paraglide/messages.js";
import { Button } from "@/ui/components/ui/button";

const DESCRIPTIONS = {
  "no-tauri": m.startup_error_no_tauri,
  "database-unavailable": m.startup_error_database_unavailable,
  error: m.startup_error_description,
} as const;

/**
 * Shown while the app opens the database: the logo, whose receipt lines are
 * written one after another (the item lines, the total, its double underline),
 * and "Datenbank wird geladen …" below it. Without motion
 * (`prefers-reduced-motion`) the logo is static.
 */
export function StartupLoadingScreen() {
  return (
    <main className="flex h-svh flex-col items-center justify-center gap-5 p-8">
      <AnimatedLogo className="size-24" />
      <p role="status" className="text-muted-foreground">
        {m.startup_loading()}
      </p>
    </main>
  );
}

/** Lines of the receipt in drawing order: [path, stroke, width, delay in s]. */
const LOGO_LINES = [
  ["M176 160H336", "#A9B9B2", 20, 0],
  ["M176 208H288", "#A9B9B2", 20, 0.15],
  ["M248 280H336", "#16302B", 24, 0.35],
  ["M232 324H336", "#E8962E", 12, 0.55],
  ["M232 356H336", "#E8962E", 12, 0.65],
] as const;

/** The app icon (src/ui/assets/brand/icon.svg) with animated lines. */
function AnimatedLogo({ className }: Readonly<{ className?: string }>) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden className={className}>
      <rect width="512" height="512" rx="112" fill="#16302B" />
      <path
        d="M136 120Q136 96 160 96H352Q376 96 376 120V400L356 424L336 400L316 424L296 400L276 424L256 400L236 424L216 400L196 424L176 400L156 424L136 400Z"
        fill="#F5F3EC"
      />
      {LOGO_LINES.map(([d, stroke, width, delay]) => (
        <path
          key={d}
          d={d}
          stroke={stroke}
          strokeWidth={width}
          strokeLinecap="round"
          // Normalized length: every line draws with the same dash values.
          pathLength={1}
          className="logo-line"
          style={{ animationDelay: `${delay}s` }}
        />
      ))}
    </svg>
  );
}

export function StartupErrorScreen({
  details,
  onRetry,
  reason,
}: Readonly<{
  details: string;
  onRetry: () => void;
  reason: "no-tauri" | "database-unavailable" | "error";
}>) {
  return (
    <main className="mx-auto flex h-svh max-w-3xl flex-col justify-center gap-4 p-8">
      <h1 className="font-heading text-[28px] leading-9 font-semibold">
        {m.startup_error_title()}
      </h1>
      <p role="alert">{DESCRIPTIONS[reason]()}</p>
      <details className="rounded-xl border bg-muted p-3 text-sm">
        <summary>{m.startup_error_details()}</summary>
        <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words">{details}</pre>
      </details>
      <div>
        <Button variant="outline" onClick={onRetry}>
          {m.startup_error_retry()}
        </Button>
      </div>
    </main>
  );
}
