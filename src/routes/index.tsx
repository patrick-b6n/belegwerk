import { createFileRoute } from "@tanstack/react-router";

import { Button } from "@/ui/components/ui/button";
import { toast } from "@/ui/components/ui/toast";

export const Route = createFileRoute("/")({
  component: Home,
});

// Placeholder until the app shell lands (#8).
function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-8">
      <h1 className="font-heading text-2xl font-semibold">Belegwerk</h1>
      <div>
        <Button onClick={() => toast.add({ title: "Belegwerk", description: "UI-Setup aktiv." })}>
          Toast anzeigen
        </Button>
      </div>
    </main>
  );
}
