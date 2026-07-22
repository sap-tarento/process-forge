import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/layout/EmptyState";
import { AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/conflicts")({
  head: () => ({
    meta: [
      { title: "Conflicts — AtomForge" },
      { name: "description", content: "Detected duplicates, overlaps, contradictions, and precedence issues between atoms." },
      { property: "og:title", content: "Conflicts — AtomForge" },
      { property: "og:description", content: "Detected duplicates, overlaps, contradictions, and precedence issues between atoms." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <AppShell title="Conflicts" description="Detected duplicates, overlaps, contradictions, and precedence issues between atoms.">
      <EmptyState
        icon={AlertTriangle}
        title="No conflicts detected"
        description="The conflict detector flags DUPLICATES, OVERLAPS, CONFLICTS_WITH, and SUPERSEDES relationships between atoms. Resolutions are governed."
      />
    </AppShell>
  );
}
