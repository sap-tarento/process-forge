import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/layout/EmptyState";
import { ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/governance")({
  head: () => ({
    meta: [
      { title: "Governance — AtomForge" },
      { name: "description", content: "Domain vocabulary, roles, authority precedence, and audit log." },
      { property: "og:title", content: "Governance — AtomForge" },
      { property: "og:description", content: "Domain vocabulary, roles, authority precedence, and audit log." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <AppShell title="Governance" description="Domain vocabulary, roles, authority precedence, and audit log.">
      <div className="grid gap-4 md:grid-cols-2">
        {[
          { t: "Domain model", d: "Corporate functions, end-to-end processes, activities, business objects, roles, systems, org units." },
          { t: "Authority precedence", d: "Regulatory ▸ Board ▸ Executive ▸ Functional ▸ Local. Resolves overlapping atoms." },
          { t: "Roles & approvers", d: "Owners and required approvers per atom, enforced on change-set promotion." },
          { t: "Audit log", d: "Immutable transaction-time history of every atom state change." },
        ].map((s) => (
          <div key={s.t} className="rounded-lg border border-border bg-card p-4">
            <div className="text-sm font-medium text-foreground">{s.t}</div>
            <p className="mt-1 text-xs text-muted-foreground">{s.d}</p>
          </div>
        ))}
      </div>
      <div className="mt-6">
        <EmptyState
          icon={ShieldCheck}
          title="Governance model not yet configured"
          description="Define the domain vocabulary and role assignments before compiling atoms into production."
        />
      </div>
    </AppShell>
  );
}
