import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/layout/EmptyState";
import { FileText, ClipboardCheck, AlertTriangle, Database, ShieldCheck, Atom } from "lucide-react";
import { ATOM_STATUSES, type AtomStatus } from "@/types/atom";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Dashboard — AtomForge" },
      { name: "description", content: "Overview of process atoms, review queue, conflicts and recent sources in your AtomForge workspace." },
      { property: "og:title", content: "Dashboard — AtomForge" },
      { property: "og:description", content: "Governed process atom compiler for organizational policy." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const stats = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const [atomsRes, atomsAll, sourcesRes, conflictsRes, reviewRes, recentSources] = await Promise.all([
        supabase.from("atoms").select("id", { count: "exact", head: true }),
        supabase.from("atoms").select("status"),
        supabase.from("sources").select("id", { count: "exact", head: true }),
        supabase.from("conflicts").select("id", { count: "exact", head: true }).eq("status", "open"),
        supabase.from("change_sets").select("id", { count: "exact", head: true }).eq("status", "pending_review"),
        supabase.from("sources").select("id, title, source_type, authority_class, created_at").order("created_at", { ascending: false }).limit(5),
      ]);
      const byStatus: Record<AtomStatus, number> = {
        candidate: 0, under_review: 0, approved: 0, active: 0, superseded: 0, withdrawn: 0,
      };
      for (const r of atomsAll.data ?? []) byStatus[r.status as AtomStatus] = (byStatus[r.status as AtomStatus] ?? 0) + 1;
      return {
        atoms: atomsRes.count ?? 0,
        sources: sourcesRes.count ?? 0,
        conflicts: conflictsRes.count ?? 0,
        reviews: reviewRes.count ?? 0,
        byStatus,
        recentSources: recentSources.data ?? [],
      };
    },
  });

  const s = stats.data;

  return (
    <AppShell
      title="Dashboard"
      description="Compilation health, review load, and conflict signal at a glance."
    >
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Database} label="Atoms" value={String(s?.atoms ?? "…")} hint={(s?.atoms ?? 0) === 0 ? "No atoms compiled yet" : "Across all lifecycle states"} />
        <StatCard icon={ClipboardCheck} label="Pending review" value={String(s?.reviews ?? "…")} hint="Change sets awaiting approval" />
        <StatCard icon={AlertTriangle} label="Open conflicts" value={String(s?.conflicts ?? "…")} hint="Overlap with incompatible actions" />
        <StatCard icon={FileText} label="Sources" value={String(s?.sources ?? "…")} hint="Registered documents" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Lifecycle distribution</CardTitle>
            <CardDescription className="text-xs">
              Atom counts across the bitemporal lifecycle states.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {ATOM_STATUSES.map((status) => (
                <div
                  key={status}
                  className="rounded-md border border-border bg-card px-3 py-2.5"
                >
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {status.replace("_", " ")}
                  </div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                    {s?.byStatus[status] ?? 0}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Atom className="h-3.5 w-3.5" />
              </div>
              <CardTitle className="text-sm">What is a process atom?</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-xs leading-relaxed text-muted-foreground">
            <p>
              A <span className="font-medium text-foreground">process atom</span> captures exactly
              one rule, constraint, or responsibility extracted from an organizational document.
            </p>
            <p>
              Each atom separates <Badge variant="secondary" className="mx-0.5 font-mono text-[10px]">applicability</Badge>
              <Badge variant="secondary" className="mx-0.5 font-mono text-[10px]">action</Badge>
              <Badge variant="secondary" className="mx-0.5 font-mono text-[10px]">purpose</Badge>
              so AI agents can reason about <em>when</em> a rule applies, <em>what</em> it requires,
              and <em>why</em> it exists — without confusing the three.
            </p>
            <p>
              Atoms are versioned, source-grounded, human-governed, and consumed by agents at runtime.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recent sources</CardTitle>
          </CardHeader>
          <CardContent>
            {!s || s.recentSources.length === 0 ? (
              <EmptyState icon={FileText} title="No sources registered yet" description="Add a policy, SOP, or regulation to begin compiling atoms." />
            ) : (
              <ul className="space-y-2">
                {s.recentSources.map((src) => (
                  <li key={src.id}>
                    <Link to="/sources" className="block rounded-md border border-border bg-card p-2 hover:bg-muted/50">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 truncate text-sm">{src.title}</div>
                        <Badge variant="outline" className="text-[10px]">{src.authority_class}</Badge>
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{src.source_type} · {new Date(src.created_at).toLocaleDateString()}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Review queue</CardTitle>
          </CardHeader>
          <CardContent>
            {(s?.reviews ?? 0) === 0 ? (
              <EmptyState icon={ShieldCheck} title="Nothing to review" description="Proposed change sets from the pipeline will appear here for governance approval." />
            ) : (
              <Link to="/review" className="block rounded-md border border-border bg-card p-3 text-sm hover:bg-muted/50">
                <div className="font-medium">{s?.reviews} change set{s?.reviews === 1 ? "" : "s"} awaiting approval</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">Open the review queue →</div>
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof FileText;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {value}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
