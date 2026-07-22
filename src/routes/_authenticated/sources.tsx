import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/layout/EmptyState";
import { FileText } from "lucide-react";

export const Route = createFileRoute("/sources")({
  head: () => ({
    meta: [
      { title: "Sources — AtomForge" },
      { name: "description", content: "Registry of policy, SOP, and regulatory documents that feed the compilation pipeline." },
      { property: "og:title", content: "Sources — AtomForge" },
      { property: "og:description", content: "Registry of policy, SOP, and regulatory documents that feed the compilation pipeline." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <AppShell title="Sources" description="Registry of policy, SOP, and regulatory documents that feed the compilation pipeline.">
      <EmptyState
        icon={FileText}
        title="No sources registered yet"
        description="Register a policy, SOP, contract, or regulation to begin extracting process atoms. Sources are version-tracked and hashed for provenance."
      />
    </AppShell>
  );
}
