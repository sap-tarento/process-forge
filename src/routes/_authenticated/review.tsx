import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/layout/EmptyState";
import { ClipboardCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/review")({
  head: () => ({
    meta: [
      { title: "Review — AtomForge" },
      { name: "description", content: "Human governance queue for proposed atom change sets." },
      { property: "og:title", content: "Review — AtomForge" },
      { property: "og:description", content: "Human governance queue for proposed atom change sets." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <AppShell title="Review" description="Human governance queue for proposed atom change sets.">
      <EmptyState
        icon={ClipboardCheck}
        title="Nothing to review"
        description="When the pipeline assembles a candidate change set, it appears here for the required approvers to accept, amend, or reject."
      />
    </AppShell>
  );
}
