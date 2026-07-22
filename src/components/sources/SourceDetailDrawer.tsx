import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { STATUS_LABEL, SOURCE_TYPE_LABEL } from "@/lib/source-types";
import type { Database } from "@/integrations/supabase/types";

type Source = Database["public"]["Tables"]["sources"]["Row"];

interface Props {
  sourceId: string | null;
  onClose: () => void;
}

export function SourceDetailDrawer({ sourceId, onClose }: Props) {
  const { data } = useQuery({
    queryKey: ["source-detail", sourceId],
    enabled: !!sourceId,
    queryFn: async () => {
      const { data, error } = await supabase.from("sources").select("*").eq("id", sourceId!).single();
      if (error) throw error;
      return data as Source;
    },
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
          </>
        )}
      </SheetContent>
    </Sheet>
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
