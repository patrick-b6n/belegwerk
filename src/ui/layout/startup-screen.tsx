import { m } from "@/paraglide/messages.js";
import { Button } from "@/ui/components/ui/button";

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
}: Readonly<{ details: string; onRetry: () => void; reason: "no-tauri" | "error" }>) {
  return (
    <main className="mx-auto flex h-svh max-w-3xl flex-col justify-center gap-4 p-8">
      <h1 className="font-heading text-2xl font-semibold">{m.startup_error_title()}</h1>
      <p role="alert">
        {reason === "no-tauri" ? m.startup_error_no_tauri() : m.startup_error_description()}
      </p>
      <details className="rounded-md border bg-muted p-3 text-sm">
        <summary className="cursor-pointer">{m.startup_error_details()}</summary>
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
