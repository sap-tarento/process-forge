import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/layout/EmptyState";
import { Database } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { LifecycleBadge } from "@/components/atom/AtomStatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KNOWLEDGE_TYPES, ATOM_STATUSES } from "@/types/atom";

export const Route = createFileRoute("/_authenticated/memory")({
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
  const [q, setQ] = useState("");
  const [kt, setKt] = useState<string>("all");
  const [st, setSt] = useState<string>("all");
  const [tag, setTag] = useState<string>("");

  const { data: atoms, isLoading } = useQuery({
    queryKey: ["memory-atoms", q, kt, st, tag],
    queryFn: async () => {
      let query = supabase
        .from("atoms")
        .select("id, atom_id, name, knowledge_type, status, version, processes, roles, business_objects, updated_at")
        .order("updated_at", { ascending: false })
        .limit(500);
      if (kt !== "all") query = query.eq("knowledge_type", kt as never);
      if (st !== "all") query = query.eq("status", st as never);
      if (q.trim()) query = query.or(`atom_id.ilike.%${q}%,name.ilike.%${q}%`);
      if (tag.trim()) query = query.or(`processes.cs.{${tag}},roles.cs.{${tag}},business_objects.cs.{${tag}}`);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = atoms ?? [];
  const total = rows.length;

  return (
    <AppShell title="Memory" description="Browse and search the compiled atom library — the governed knowledge consumed by agents at runtime.">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input placeholder="Search atom id or name…" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
        <Select value={kt} onValueChange={setKt}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Knowledge type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All knowledge types</SelectItem>
            {KNOWLEDGE_TYPES.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={st} onValueChange={setSt}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Lifecycle" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {ATOM_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input placeholder="Tag (process / role / object)…" value={tag} onChange={(e) => setTag(e.target.value)} className="w-64" />
        <div className="ml-auto text-xs text-muted-foreground tabular-nums">{total} atom{total === 1 ? "" : "s"}</div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Database} title="No atoms match" description="Approved atoms appear here once the pipeline publishes them; candidates appear while under review." />
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[26rem]">Atom</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead className="w-16 text-right">v</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id} className="cursor-pointer">
                  <TableCell>
                    <Link to="/atoms/$id" params={{ id: a.id }} className="block">
                      <div className="font-mono text-xs text-primary">{a.atom_id}</div>
                      <div className="text-sm text-foreground">{a.name}</div>
                    </Link>
                  </TableCell>
                  <TableCell><Badge variant="secondary" className="text-[10px]">{a.knowledge_type}</Badge></TableCell>
                  <TableCell><LifecycleBadge status={a.status} /></TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">
                    {[...(a.processes ?? []), ...(a.roles ?? []), ...(a.business_objects ?? [])].slice(0, 4).join(" · ") || "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{a.version}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AppShell>
  );
}
