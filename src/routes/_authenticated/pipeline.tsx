import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/layout/EmptyState";
import { Workflow } from "lucide-react";

export const Route = createFileRoute("/_authenticated/pipeline")({
  head: () => ({
    meta: [
      { title: "Pipeline — AtomForge" },
      { name: "description", content: "14-stage compilation from raw source to governed atom change set." },
      { property: "og:title", content: "Pipeline — AtomForge" },
      { property: "og:description", content: "14-stage compilation from raw source to governed atom change set." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <AppShell title="Pipeline" description="14-stage compilation from raw source to governed atom change set.">
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
        {[
          "ingest","parse","segment","classify","extract candidates","resolve scope","resolve action",
          "resolve purpose","tag domain","ground evidence","detect conflicts","score quality","assemble change set","queue for review",
        ].map((s, i) => (
          <div key={s} className="rounded-md border border-border bg-card px-2.5 py-2">
            <div className="text-[10px] font-mono text-muted-foreground">{String(i + 1).padStart(2, "0")}</div>
            <div className="text-xs font-medium capitalize text-foreground">{s}</div>
          </div>
        ))}
      </div>
      <EmptyState
        icon={Workflow}
        title="No pipeline runs yet"
        description="Trigger a run from a registered source to compile candidate atoms through all 14 stages."
      />
    </AppShell>
  );
}
