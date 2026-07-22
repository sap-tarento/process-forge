import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { STATUS_LABEL, SOURCE_TYPE_LABEL } from "@/lib/source-types";
import { useMyRoles, hasAnyRole } from "@/hooks/useAuth";
import { parseSource } from "@/lib/pipeline/parse-source.functions";
import { runPipeline } from "@/lib/pipeline/run-pipeline.functions";
import { FileSearch, Play, Loader2 } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Source = Database["public"]["Tables"]["sources"]["Row"];

interface Props {
  sourceId: string | null;
  onClose: () => void;
}

export function SourceDetailDrawer({ sourceId, onClose }: Props) {
  const qc = useQueryClient();
  const { data: roles } = useMyRoles();
  const canRun = hasAnyRole(roles, ["admin", "curator", "policy_owner"]);
  const parseFn = useServerFn(parseSource);
  const runFn = useServerFn(runPipeline);

  const { data } = useQuery({
    queryKey: ["source-detail", sourceId],
    enabled: !!sourceId,
    queryFn: async () => {
      const { data, error } = await supabase.from("sources").select("*").eq("id", sourceId!).single();
      if (error) throw error;
      return data as Source;
    },
  });

  const parseMut = useMutation({
    mutationFn: () => parseFn({ data: { sourceId: sourceId! } }),
    onSuccess: (r) => {
      toast.success(`Parsed: ${r.block_count} blocks across ${r.page_count} pages`);
      qc.invalidateQueries({ queryKey: ["sources"] });
      qc.invalidateQueries({ queryKey: ["source-detail", sourceId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runMut = useMutation({
    mutationFn: () => runFn({ data: { sourceId: sourceId! } }),
    onSuccess: (r) => {
      toast.success(`Pipeline complete — ${r.produced} atoms drafted from ${r.spans_detected} spans`);
      qc.invalidateQueries({ queryKey: ["sources"] });
      qc.invalidateQueries({ queryKey: ["source-detail", sourceId] });
      qc.invalidateQueries({ queryKey: ["pipeline-runs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: chain } = useQuery({
    queryKey: ["source-chain", sourceId],
    enabled: !!data,
    queryFn: async () => {
      // Walk supersession chain upward and downward
      const chain: Source[] = [];
      let current: Source | null = data ?? null;
      const seenUp = new Set<string>();
      while (current?.superseded_source_id && !seenUp.has(current.superseded_source_id)) {
        seenUp.add(current.superseded_source_id);
        const { data: prev } = await supabase.from("sources").select("*").eq("id", current.superseded_source_id).maybeSingle();
        if (!prev) break;
        chain.unshift(prev as Source);
        current = prev as Source;
      }
      if (data) chain.push(data);
      // Downward: sources that reference this one
      const { data: next } = await supabase.from("sources").select("*").eq("superseded_source_id", data!.id);
      if (next) chain.push(...(next as Source[]));
      return chain;
    },
  });

  return (
    <Sheet open={!!sourceId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[520px] sm:max-w-[520px] overflow-y-auto">
        {data && (
          <>
            <SheetHeader>
              <SheetTitle className="text-base">{data.title}</SheetTitle>
              <SheetDescription className="font-mono text-xs">{data.source_id}</SheetDescription>
            </SheetHeader>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge variant="outline">{SOURCE_TYPE_LABEL[data.source_type]}</Badge>
              <Badge variant={data.authority_class === "NORMATIVE" ? "default" : "secondary"}>
                {data.authority_class}
              </Badge>
              <Badge variant="outline">{STATUS_LABEL[data.status]}</Badge>
              <Badge variant="outline">v{data.version}</Badge>
            </div>

            {canRun && (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => parseMut.mutate()}
                  disabled={parseMut.isPending || runMut.isPending}
                >
                  {parseMut.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileSearch className="mr-1.5 h-3.5 w-3.5" />}
                  Parse (Stage 2)
                </Button>
                <Button
                  size="sm"
                  onClick={() => runMut.mutate()}
                  disabled={runMut.isPending || parseMut.isPending || data.status === "registered"}
                >
                  {runMut.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                  Run pipeline (Stages 3–6)
                </Button>
              </div>
            )}

            <Separator className="my-4" />

            <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
              <Meta label="Owner" value={data.owner ?? "—"} />
              <Meta label="Approval" value={data.approval_status ?? "—"} />
              <Meta label="Effective" value={data.effective_date ?? "—"} />
              <Meta label="Ingested" value={new Date(data.ingestion_timestamp).toLocaleString()} full />
              <Meta label="SHA-256" value={data.file_sha256 ?? "—"} mono full />
              <Meta label="File path" value={data.file_path ?? "(pasted text)"} mono full />
            </dl>

            <Separator className="my-4" />

            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Supersession chain
              </div>
              {chain && chain.length > 0 ? (
                <ol className="space-y-1">
                  {chain.map((s) => (
                    <li key={s.id} className={`rounded-md border px-2 py-1.5 text-xs ${s.id === data.id ? "border-primary bg-primary/5" : "border-border"}`}>
                      <div className="font-mono text-[11px]">{s.source_id} · v{s.version}</div>
                      <div className="text-muted-foreground">{s.title}</div>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="text-xs text-muted-foreground">Standalone — no supersession chain.</div>
              )}
            </div>

            <Separator className="my-4" />
            <DocumentStructure sourceId={data.id} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

interface Block {
  order: number;
  type: string;
  text: string;
  page: number;
  heading_level?: number;
  heading_path: string[];
}

function DocumentStructure({ sourceId }: { sourceId: string }) {
  const { data } = useQuery({
    queryKey: ["source-document", sourceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("source_documents")
        .select("layout, page_count, parser_version")
        .eq("source_id", sourceId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (!data) {
    return (
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Document structure
        </div>
        <div className="text-xs text-muted-foreground">Not parsed yet. Run Parse to build the block tree.</div>
      </div>
    );
  }

  const layout = (data.layout ?? {}) as { blocks?: Block[] };
  const blocks = layout.blocks ?? [];
  const headings = blocks.filter((b) => b.type === "heading").slice(0, 40);
  const paragraphs = blocks.filter((b) => b.type === "paragraph").length;
  const listItems = blocks.filter((b) => b.type === "list_item").length;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Document structure
        </div>
        <div className="text-[11px] font-mono text-muted-foreground">
          parser v{data.parser_version} · {data.page_count} pages
        </div>
      </div>
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span><span className="font-mono">{headings.length}</span> headings</span>
        <span><span className="font-mono">{paragraphs}</span> paragraphs</span>
        <span><span className="font-mono">{listItems}</span> list items</span>
      </div>
      <div className="max-h-[260px] overflow-y-auto rounded-md border border-border">
        {headings.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground">No headings detected.</div>
        ) : (
          <ol className="divide-y divide-border">
            {headings.map((h) => (
              <li key={h.order} className="flex items-baseline gap-2 px-2 py-1 text-xs" style={{ paddingLeft: `${8 + (h.heading_level ?? 1) * 10}px` }}>
                <span className="font-mono text-[10px] text-muted-foreground">p{h.page}</span>
                <span className="truncate text-foreground">{h.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function Meta({ label, value, mono, full }: { label: string; value: string; mono?: boolean; full?: boolean }) {
  return (
    <>
      <dt className={`text-muted-foreground ${full ? "col-span-3" : ""}`}>{label}</dt>
      <dd className={`${mono ? "font-mono" : ""} ${full ? "col-span-3 break-all text-foreground" : "col-span-2 text-foreground"}`}>{value}</dd>
    </>
  );
}
