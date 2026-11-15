import { m } from "@/paraglide/messages.js";
import { Button } from "@/ui/components/ui/button";

const DESCRIPTIONS = {
  "no-tauri": m.startup_error_no_tauri,
  "database-unavailable": m.startup_error_database_unavailable,
  error: m.startup_error_description,
} as const;

/** Shown while the app opens the database. */
export function StartupLoadingScreen() {
  return (
    <main className="flex h-svh items-center justify-center p-8">
      <p role="status" className="text-muted-foreground">
        {m.startup_loading()}
      </p>
    </main>
  );
}

/** Shown instead of the app if it could not start. */
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
