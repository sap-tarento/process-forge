import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/layout/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/conflicts")({
  head: () => ({
    meta: [
      { title: "Conflicts — AtomForge" },
      { name: "description", content: "Detected duplicates, overlaps, contradictions, and precedence-resolved decisions." },
      { property: "og:title", content: "Conflicts — AtomForge" },
      { property: "og:description", content: "Detected duplicates, overlaps, contradictions, and precedence-resolved decisions." },
    ],
  }),
  component: Page,
});

function Page() {
  const { data, isLoading } = useQuery({
    queryKey: ["conflicts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conflicts")
        .select("id, atom_a, atom_b_atom_id, conflict_kind, detail, status, created_at, resolutions(id, strategy, winning_atom_id, reason, approved_by, created_at)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <AppShell title="Conflicts" description="Detected duplicates, overlaps, and incompatible actions; each resolution records the precedence strategy applied.">
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : !data?.length ? (
        <EmptyState icon={AlertTriangle} title="No conflicts recorded"
          description="Conflicts are recorded only after a reviewer explicitly resolves an overlap_conflict finding in the Review workspace. In-flight findings live on their change-set item." />
      ) : (
        <div className="space-y-2">
          {data.map((c) => {
            const rs = (c as { resolutions?: { strategy: string; winning_atom_id: string; reason: string }[] }).resolutions ?? [];
            return (
              <Card key={c.id}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-[10px]">{c.conflict_kind}</Badge>
                      <span className="font-mono text-xs">{c.atom_b_atom_id}</span>
                      <span className="text-xs text-muted-foreground">vs atom_a id {c.atom_a?.slice?.(0, 8)}…</span>
                    </div>
                    <Badge className={c.status === "resolved" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" : "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"}>
                      {c.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {(c.detail as { finding?: { detail?: { reason?: string } } })?.finding?.detail?.reason ?? "—"}
                  </div>
                  {rs.map((r, i) => (
                    <div key={i} className="rounded border border-border bg-muted/30 p-2 text-xs">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">strategy: {r.strategy}</Badge>
                        <span className="text-muted-foreground">winner:</span>
                        <span className="font-mono">{r.winning_atom_id}</span>
                      </div>
                      <div className="mt-1 text-muted-foreground">{r.reason}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
