import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/layout/EmptyState";
import { ShieldCheck, Trash2, Plus, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import {
  createDomainEntry,
  deleteDomainEntry,
  decideTagProposal,
  assignRole,
  revokeRole,
  listAllUsersWithRoles,
  setStrategyEnabled,
  createStrategy,
} from "@/lib/domain-model.functions";
import { useMyRoles, hasAnyRole } from "@/hooks/useAuth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/governance")({
  head: () => ({
    meta: [
      { title: "Governance — AtomForge" },
      { name: "description", content: "Domain vocabulary, roles, authority precedence, and audit log." },
      { property: "og:title", content: "Governance — AtomForge" },
      { property: "og:description", content: "Domain vocabulary, roles, authority precedence, and audit log." },
    ],
  }),
  component: Page,
});

const CATEGORIES = [
  "corporate_function", "end_to_end_process", "process", "activity",
  "business_object", "role", "system", "organizational_unit",
] as const;

function Page() {
  const roles = useMyRoles();
  const canCurate = hasAnyRole(roles.data, ["admin", "policy_owner", "curator"]);
  const isAdmin = hasAnyRole(roles.data, ["admin"]);

  return (
    <AppShell title="Governance" description="Domain vocabulary, roles, authority precedence, and audit log.">
      <Tabs defaultValue="domain">
        <TabsList>
          <TabsTrigger value="domain">Domain model</TabsTrigger>
          <TabsTrigger value="proposals">Tag proposals</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
          <TabsTrigger value="precedence">Precedence</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>
        <TabsContent value="domain" className="mt-4"><DomainTab canEdit={canCurate} /></TabsContent>
        <TabsContent value="proposals" className="mt-4"><ProposalsTab canEdit={canCurate} /></TabsContent>
        <TabsContent value="roles" className="mt-4"><RolesTab canEdit={isAdmin} /></TabsContent>
        <TabsContent value="precedence" className="mt-4"><PrecedenceTab canEdit={isAdmin} /></TabsContent>
        <TabsContent value="audit" className="mt-4"><AuditTab /></TabsContent>
      </Tabs>
    </AppShell>
  );
}

function DomainTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const create = useServerFn(createDomainEntry);
  const del = useServerFn(deleteDomainEntry);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("process");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");

  const { data: entries } = useQuery({
    queryKey: ["domain-model"],
    queryFn: async () => {
      const { data, error } = await supabase.from("domain_model").select("*").order("category").order("value");
      if (error) throw error;
      return data ?? [];
    },
  });

  const addMut = useMutation({
    mutationFn: async () => create({ data: { category, value: value.trim(), label: label.trim() || value.trim() } }),
    onSuccess: () => { toast.success("Added"); setValue(""); setLabel(""); qc.invalidateQueries({ queryKey: ["domain-model"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const delMut = useMutation({
    mutationFn: async (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["domain-model"] }),
  });

  const grouped = new Map<string, typeof entries>();
  for (const e of entries ?? []) {
    const arr = grouped.get(e.category) ?? [];
    arr.push(e);
    grouped.set(e.category, arr);
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Add vocabulary entry</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div>
              <div className="mb-1 text-[11px] text-muted-foreground">Category</div>
              <Select value={category} onValueChange={(v) => setCategory(v as never)}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-[11px] text-muted-foreground">Value (lower_snake_case)</div>
              <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="purchase_requisition" className="w-56 font-mono" />
            </div>
            <div>
              <div className="mb-1 text-[11px] text-muted-foreground">Label</div>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Purchase Requisition" className="w-64" />
            </div>
            <Button onClick={() => addMut.mutate()} disabled={!value.trim() || addMut.isPending}><Plus className="mr-1 h-3.5 w-3.5" />Add</Button>
          </CardContent>
        </Card>
      )}

      {(!entries || entries.length === 0) ? (
        <EmptyState icon={ShieldCheck} title="Domain vocabulary is empty" description="Add corporate functions, processes, roles, and business objects that atoms will be tagged against." />
      ) : (
        CATEGORIES.filter((c) => grouped.has(c)).map((c) => (
          <Card key={c}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">{c.replace(/_/g, " ")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {(grouped.get(c) ?? []).map((e) => (
                <span key={e.id} className="group inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs">
                  <span className="font-mono text-primary">{e.value}</span>
                  <span className="text-muted-foreground">— {e.label}</span>
                  {canEdit && (
                    <button onClick={() => delMut.mutate(e.id)} className="ml-1 opacity-0 transition group-hover:opacity-100" aria-label="Delete">
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </button>
                  )}
                </span>
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function ProposalsTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const decide = useServerFn(decideTagProposal);
  const { data: proposals } = useQuery({
    queryKey: ["tag-proposals"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tag_proposals").select("*").eq("status", "proposed").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const mut = useMutation({
    mutationFn: async (v: { id: string; decision: "accept" | "reject" }) => decide({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tag-proposals"] }); qc.invalidateQueries({ queryKey: ["domain-model"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!proposals || proposals.length === 0) {
    return <EmptyState icon={ShieldCheck} title="No pending tag proposals" description="Stage 7 proposes new vocabulary when atoms mention domain concepts not yet in the model." />;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow><TableHead>Category</TableHead><TableHead>Proposed value</TableHead><TableHead>Label</TableHead><TableHead>Rationale</TableHead><TableHead className="text-right">Decision</TableHead></TableRow>
      </TableHeader>
      <TableBody>
        {proposals.map((p) => (
          <TableRow key={p.id}>
            <TableCell><Badge variant="secondary" className="text-[10px]">{p.category}</Badge></TableCell>
            <TableCell className="font-mono text-xs text-primary">{p.value}</TableCell>
            <TableCell className="text-sm">{p.label}</TableCell>
            <TableCell className="text-xs text-muted-foreground max-w-md">{p.rationale ?? "—"}</TableCell>
            <TableCell className="text-right">
              {canEdit ? (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="outline" onClick={() => mut.mutate({ id: p.id, decision: "accept" })}><Check className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="outline" onClick={() => mut.mutate({ id: p.id, decision: "reject" })}><X className="h-3.5 w-3.5" /></Button>
                </div>
              ) : <span className="text-[11px] text-muted-foreground">curator+ only</span>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const ROLE_OPTIONS = ["admin", "policy_owner", "curator", "reviewer", "viewer"] as const;

function RolesTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listAllUsersWithRoles);
  const assign = useServerFn(assignRole);
  const revoke = useServerFn(revokeRole);
  const { data: users, error } = useQuery({
    queryKey: ["users-with-roles"],
    queryFn: async () => listFn(),
    enabled: canEdit,
  });
  const assignMut = useMutation({
    mutationFn: async (v: { user_id: string; role: (typeof ROLE_OPTIONS)[number] }) => assign({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users-with-roles"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const revokeMut = useMutation({
    mutationFn: async (v: { user_id: string; role: (typeof ROLE_OPTIONS)[number] }) => revoke({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users-with-roles"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!canEdit) return <div className="text-sm text-muted-foreground">Admin only.</div>;
  if (error) return <div className="text-sm text-destructive">{(error as Error).message}</div>;
  if (!users) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <Table>
      <TableHeader>
        <TableRow><TableHead>User</TableHead><TableHead>Roles</TableHead><TableHead className="w-64 text-right">Assign role</TableHead></TableRow>
      </TableHeader>
      <TableBody>
        {users.map((u) => (
          <TableRow key={u.id}>
            <TableCell className="text-sm">{u.email}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {u.roles.length === 0 ? <span className="text-[11px] italic text-muted-foreground">no roles</span> :
                  u.roles.map((r) => (
                    <span key={r} className="group inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px]">
                      <span className="font-mono">{r}</span>
                      <button onClick={() => revokeMut.mutate({ user_id: u.id, role: r as never })} className="opacity-0 group-hover:opacity-100" aria-label="Revoke"><X className="h-3 w-3 text-destructive" /></button>
                    </span>
                  ))}
              </div>
            </TableCell>
            <TableCell className="text-right">
              <Select onValueChange={(role) => assignMut.mutate({ user_id: u.id, role: role as never })}>
                <SelectTrigger className="ml-auto w-40"><SelectValue placeholder="+ role" /></SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r} disabled={u.roles.includes(r)}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PrecedenceTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const toggle = useServerFn(setStrategyEnabled);
  const create = useServerFn(createStrategy);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const { data: strategies } = useQuery({
    queryKey: ["precedence-strategies"],
    queryFn: async () => {
      const { data, error } = await supabase.from("precedence_strategies").select("*").order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
  const toggleMut = useMutation({
    mutationFn: async (v: { id: string; enabled: boolean }) => toggle({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["precedence-strategies"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const createMut = useMutation({
    mutationFn: async () => create({ data: { name: name.trim(), description: desc.trim() } }),
    onSuccess: () => { toast.success("Strategy added"); setName(""); setDesc(""); qc.invalidateQueries({ queryKey: ["precedence-strategies"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Precedence strategies decide which atom wins when two atoms overlap and conflict. Enabled strategies apply in configured order — no strategy is hard-coded.
      </p>
      <div className="space-y-2">
        {(strategies ?? []).map((s) => (
          <div key={s.id} className="flex items-start justify-between gap-3 rounded-md border border-border bg-card p-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{s.name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.description}</div>
            </div>
            <Switch checked={s.enabled} disabled={!canEdit} onCheckedChange={(v) => toggleMut.mutate({ id: s.id, enabled: v })} />
          </div>
        ))}
      </div>
      {canEdit && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Add custom strategy</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Strategy name" />
            <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Describe when this strategy applies and how it picks the winning atom." rows={3} />
            <Button onClick={() => createMut.mutate()} disabled={!name.trim() || !desc.trim() || createMut.isPending}><Plus className="mr-1 h-3.5 w-3.5" />Add strategy</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AuditTab() {
  const [type, setType] = useState<string>("all");
  const { data: events } = useQuery({
    queryKey: ["audit-events", type],
    queryFn: async () => {
      let q = supabase.from("audit_events").select("*").order("created_at", { ascending: false }).limit(200);
      if (type !== "all") q = q.eq("event_type", type);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
  const eventTypes = Array.from(new Set((events ?? []).map((e) => e.event_type)));

  if (!events || events.length === 0) {
    return <EmptyState icon={ShieldCheck} title="No audit events yet" description="Every state change — source registration, pipeline run, atom publication, role change — is recorded here immutably." />;
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All event types</SelectItem>
            {eventTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow><TableHead className="w-44">When</TableHead><TableHead>Event</TableHead><TableHead>Entity</TableHead><TableHead>Payload</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {events.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-mono text-[11px] text-muted-foreground">{new Date(e.created_at).toLocaleString()}</TableCell>
                <TableCell><Badge variant="secondary" className="font-mono text-[10px]">{e.event_type}</Badge></TableCell>
                <TableCell className="font-mono text-[11px] text-muted-foreground">{e.entity_type} / {(e.entity_id ?? "").slice(0, 8)}…</TableCell>
                <TableCell><PayloadCell value={e.payload} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function PayloadCell({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="text-[11px] text-primary hover:underline" onClick={() => setOpen((o) => !o)}>
        {open ? "hide" : "view"}
      </button>
      {open && (
        <pre className="mt-1 max-h-64 overflow-auto rounded bg-muted/40 p-2 font-mono text-[10px]">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}
