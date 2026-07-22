import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Workflow, CheckCircle2, XCircle, Circle, Loader2, MinusCircle, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/layout/EmptyState";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { PIPELINE_STAGES, STAGE_LABELS, STAGE_SHORT_LABELS, type PipelineStage } from "@/types/atom";
import { cn } from "@/lib/utils";

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

interface PipelineRun {
  id: string;
  source_id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  change_set_id: string | null;
  source?: { source_id: string; title: string } | null;
}

interface StageRow {
  id: string;
  stage: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  counts: Record<string, number> | null;
}

function Page() {
  const [selectedRun, setSelectedRun] = useState<string | null>(null);

  const runsQ = useQuery({
    queryKey: ["pipeline-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_runs")
        .select("id, source_id, status, started_at, finished_at, error, change_set_id, source:sources(source_id, title)")
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as unknown as PipelineRun[];
    },
    refetchInterval: 5000,
  });

  const runs = runsQ.data ?? [];
  const activeRunId = selectedRun ?? runs[0]?.id ?? null;

  const stagesQ = useQuery({
    queryKey: ["pipeline-run-stages", activeRunId],
    enabled: !!activeRunId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_run_stages")
        .select("id, stage, status, started_at, finished_at, error, counts")
        .eq("run_id", activeRunId!);
      if (error) throw error;
      return data as unknown as StageRow[];
    },
    refetchInterval: 3000,
  });

  return (
    <AppShell title="Pipeline" description="14-stage compilation from raw source to governed atom change set.">
      {runs.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No pipeline runs yet"
          description="Register and parse a source, then run the pipeline from the Sources page to compile candidate atoms."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
          {/* Runs list */}
          <div className="rounded-md border border-border">
            <div className="border-b border-border bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Runs
            </div>
            <ul className="max-h-[600px] overflow-y-auto">
              {runs.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => setSelectedRun(r.id)}
                    className={cn(
                      "flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left hover:bg-muted/40",
                      activeRunId === r.id && "bg-muted/50",
                    )}
                  >
                    <RunStatusIcon status={r.status} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{r.source?.title ?? "Untitled"}</div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {r.source?.source_id ?? r.source_id.slice(0, 8)}
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(r.started_at).toLocaleDateString()}
                    </div>
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Stage tracker */}
          <div className="rounded-md border border-border">
            {activeRunId && stagesQ.data ? (
              <StageTracker
                run={runs.find((r) => r.id === activeRunId)!}
                stages={stagesQ.data}
              />
            ) : (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {stagesQ.isLoading ? "Loading stages…" : "Select a run"}
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}

function StageTracker({ run, stages }: { run: PipelineRun; stages: StageRow[] }) {
  const stageMap = new Map(stages.map((s) => [s.stage, s]));
  const rows = PIPELINE_STAGES.map((stage, i) => ({
    idx: i + 1,
    stage,
    row: stageMap.get(stage),
  }));

  return (
    <div>
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
        <div>
          <div className="text-sm font-semibold">{run.source?.title}</div>
          <div className="font-mono text-[11px] text-muted-foreground">
            run · {run.id.slice(0, 8)} · started {new Date(run.started_at).toLocaleString()}
          </div>
        </div>
        <Badge
          variant={run.status === "succeeded" ? "default" : run.status === "failed" ? "destructive" : "secondary"}
        >
          {run.status}
        </Badge>
      </div>

      {run.error && (
        <div className="border-b border-destructive/40 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {run.error}
        </div>
      )}

      <ol className="divide-y divide-border">
        {rows.map(({ idx, stage, row }) => (
          <li key={stage} className="flex items-start gap-3 px-4 py-3">
            <div className="mt-0.5">
              <StageStatusIcon status={row?.status ?? "pending"} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {String(idx).padStart(2, "0")}
                </span>
                <span className="text-xs font-medium text-foreground">
                  {STAGE_LABELS[stage as PipelineStage]}
                </span>
              </div>
              {row?.counts && Object.keys(row.counts).length > 0 && (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  {Object.entries(row.counts).map(([k, v]) => (
                    <span key={k}>
                      <span className="font-mono">{v}</span> {k.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              )}
              {row?.error && (
                <div className="mt-1 text-[11px] text-destructive">{row.error}</div>
              )}
              {row?.status === "not_implemented" && (
                <div className="mt-1 text-[11px] text-muted-foreground italic">
                  Not yet implemented (Stages 7–14 land in the next milestone).
                </div>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {STAGE_SHORT_LABELS[stage as PipelineStage]}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function RunStatusIcon({ status }: { status: string }) {
  if (status === "succeeded") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (status === "failed") return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  return <Circle className="h-3.5 w-3.5 text-muted-foreground" />;
}

function StageStatusIcon({ status }: { status: string }) {
  if (status === "succeeded") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-destructive" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  if (status === "not_implemented") return <MinusCircle className="h-4 w-4 text-muted-foreground/60" />;
  return <Circle className="h-4 w-4 text-muted-foreground" />;
}
