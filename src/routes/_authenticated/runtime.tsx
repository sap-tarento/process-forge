import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/layout/EmptyState";
import { Play } from "lucide-react";

export const Route = createFileRoute("/runtime")({
  head: () => ({
    meta: [
      { title: "Runtime — AtomForge" },
      { name: "description", content: "Simulate an agent context request against the current atom memory." },
      { property: "og:title", content: "Runtime — AtomForge" },
      { property: "og:description", content: "Simulate an agent context request against the current atom memory." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <AppShell title="Runtime" description="Simulate an agent context request against the current atom memory.">
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="text-sm font-medium text-foreground">Retrieval playground</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Provide an execution context (process, activity, role, org unit, business object) and see which atoms would be
          returned. Retrieval never treats <span className="font-mono text-foreground">not_stated</span> scope as universal.
        </p>
        <div className="mt-6">
          <EmptyState
            icon={Play}
            title="No atoms to retrieve against"
            description="Populate the atom memory to enable the runtime playground."
          />
        </div>
      </div>
    </AppShell>
  );
}
