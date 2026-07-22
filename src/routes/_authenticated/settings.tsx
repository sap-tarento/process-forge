import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/layout/EmptyState";
import { Settings } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — AtomForge" },
      { name: "description", content: "LLM providers, extraction prompts, and workspace configuration." },
      { property: "og:title", content: "Settings — AtomForge" },
      { property: "og:description", content: "LLM providers, extraction prompts, and workspace configuration." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <AppShell title="Settings" description="LLM providers, extraction prompts, and workspace configuration.">
      <div className="grid gap-4 md:grid-cols-2">
        {[
          { t: "LLM providers", d: "Configure extraction and validation models. Provider keys are stored server-side." },
          { t: "Prompt versions", d: "Every atom records the extraction prompt version that produced it — pinned in provenance." },
          { t: "Parser & extractor", d: "Pinned versions of the parser and extractor for reproducible compilation." },
          { t: "Workspace", d: "Name, description, and open-source license attribution." },
        ].map((s) => (
          <div key={s.t} className="rounded-lg border border-border bg-card p-4">
            <div className="text-sm font-medium text-foreground">{s.t}</div>
            <p className="mt-1 text-xs text-muted-foreground">{s.d}</p>
          </div>
        ))}
      </div>
      <div className="mt-6">
        <EmptyState
          icon={Settings}
          title="Backend not yet connected"
          description="Enable Lovable Cloud in the next step to configure providers, prompts, and persist workspace settings."
        />
      </div>
    </AppShell>
  );
}
