import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/layout/EmptyState";
import { Database, MoreHorizontal, Archive, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { LifecycleBadge } from "@/components/atom/AtomStatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { KNOWLEDGE_TYPES, ATOM_STATUSES } from "@/types/atom";
import { useMyRoles, hasAnyRole } from "@/hooks/useAuth";
import { ConfirmDeleteDialog } from "@/components/common/ConfirmDeleteDialog";
import { SelectionBar } from "@/components/common/SelectionBar";
import { withdrawAtoms, deleteAtoms } from "@/lib/management.functions";

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmWithdraw, setConfirmWithdraw] = useState<string[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const { data: roles } = useMyRoles();
  const canWithdraw = hasAnyRole(roles, ["admin", "curator", "policy_owner"]);
  const canDelete = hasAnyRole(roles, ["admin"]);
  const qc = useQueryClient();
  const withdrawFn = useServerFn(withdrawAtoms);
  const deleteFn = useServerFn(deleteAtoms);

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

  const toggle = (id: string) => setSelectedIds((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleAll = () => setSelectedIds((prev) =>
    prev.size === rows.length ? new Set() : new Set(rows.map((a) => a.id))
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["memory-atoms"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const withdrawMut = useMutation({
    mutationFn: (ids: string[]) => withdrawFn({ data: { ids } }),
    onSuccess: (r) => {
      const res = r as { withdrawn: string[] };
      toast.success(`Withdrew ${res.withdrawn.length} atom(s)`);
      setSelectedIds(new Set()); setConfirmWithdraw(null); invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (ids: string[]) => deleteFn({ data: { ids } }),
    onSuccess: (r) => {
      const res = r as { deleted: string[] };
      toast.success(`Deleted ${res.deleted.length} atom(s)`);
      setSelectedIds(new Set()); setConfirmDelete(null); invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSelect = canWithdraw || canDelete;

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
                {canSelect && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={rows.length > 0 && selectedIds.size === rows.length}
                      onCheckedChange={toggleAll}
                      aria-label="Select all"
                    />
                  </TableHead>
                )}
                <TableHead className="w-[26rem]">Atom</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead className="w-16 text-right">v</TableHead>
                {canSelect && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id} className="cursor-pointer">
                  {canSelect && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selectedIds.has(a.id)} onCheckedChange={() => toggle(a.id)} aria-label={`Select ${a.atom_id}`} />
                    </TableCell>
                  )}
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
                  {canSelect && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-7 w-7"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canWithdraw && (
                            <DropdownMenuItem onClick={() => setConfirmWithdraw([a.id])}>
                              <Archive className="mr-2 h-3.5 w-3.5" /> Withdraw
                            </DropdownMenuItem>
                          )}
                          {canDelete && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirmDelete([a.id])}>
                                <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete permanently
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canSelect && (
        <SelectionBar selectedCount={selectedIds.size} onClear={() => setSelectedIds(new Set())}>
          {canWithdraw && (
            <Button size="sm" variant="outline" onClick={() => setConfirmWithdraw(Array.from(selectedIds))}>
              <Archive className="mr-1.5 h-3.5 w-3.5" /> Withdraw
            </Button>
          )}
          {canDelete && (
            <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(Array.from(selectedIds))}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
            </Button>
          )}
        </SelectionBar>
      )}

      <ConfirmDeleteDialog
        open={!!confirmWithdraw}
        onOpenChange={(o) => !o && setConfirmWithdraw(null)}
        title={`Withdraw ${confirmWithdraw?.length ?? 0} atom(s)?`}
        description={`Marks ${confirmWithdraw?.length ?? 0} atom(s) as withdrawn (kept for audit; removed from active memory).`}
        confirmLabel="Withdraw"
        loading={withdrawMut.isPending}
        onConfirm={() => confirmWithdraw && withdrawMut.mutate(confirmWithdraw)}
      />

      <ConfirmDeleteDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={`Permanently delete ${confirmDelete?.length ?? 0} atom(s)?`}
        description={`Permanently removes ${confirmDelete?.length ?? 0} atom(s), their relationships, and conflict records. This cannot be undone.`}
        confirmLabel="Delete permanently"
        loading={deleteMut.isPending}
        onConfirm={() => confirmDelete && deleteMut.mutate(confirmDelete)}
      />
    </AppShell>
  );
}
