import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/layout/EmptyState";
import { Database } from "lucide-react";

export const Route = createFileRoute("/memory")({
  head: () => ({
    meta: [
      { title: "Memory — AtomForge" },
      { name: "description", content: "Browse and search the compiled atom library — the governed knowledge consumed by agents at runtime." },
      { property: "og:title", content: "Memory — AtomForge" },
      { property: "og:description", content: "Browse and search the compiled atom library — the governed knowledge consumed by agents at runtime." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <AppShell title="Memory" description="Browse and search the compiled atom library — the governed knowledge consumed by agents at runtime.">
      <EmptyState
        icon={Database}
        title="The atom library is empty"
        description="Approved atoms will appear here, searchable by domain tag, knowledge type, actor, and applicability scope."
      />
    </AppShell>
  );
}
