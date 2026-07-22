import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/layout/EmptyState";
import { FileText, ClipboardCheck, AlertTriangle, Database, ShieldCheck, Atom } from "lucide-react";

export const Route = createFileRoute("/")({
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

const lifecycle = [
  { label: "Candidate", value: 0 },
  { label: "Under review", value: 0 },
  { label: "Approved", value: 0 },
  { label: "Active", value: 0 },
  { label: "Superseded", value: 0 },
  { label: "Withdrawn", value: 0 },
];

function Dashboard() {
  return (
    <AppShell
      title="Dashboard"
      description="Compilation health, review load, and conflict signal at a glance."
    >
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Database} label="Atoms" value="0" hint="No atoms compiled yet" />
        <StatCard icon={ClipboardCheck} label="Pending review" value="0" hint="Change sets awaiting approval" />
        <StatCard icon={AlertTriangle} label="Open conflicts" value="0" hint="Requires resolution" />
        <StatCard icon={FileText} label="Sources" value="0" hint="Registered documents" />
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
              {lifecycle.map((s) => (
                <div
                  key={s.label}
                  className="rounded-md border border-border bg-card px-3 py-2.5"
                >
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {s.label}
                  </div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                    {s.value}
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
            <EmptyState
              icon={FileText}
              title="No sources registered yet"
              description="Add a policy, SOP, or regulation to begin compiling atoms."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Review queue</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={ShieldCheck}
              title="Nothing to review"
              description="Proposed change sets from the pipeline will appear here for governance approval."
            />
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
