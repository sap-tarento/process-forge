import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/layout/EmptyState";
import { AtomDetail } from "@/components/atom/AtomDetail";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ClipboardCheck, Loader2, CheckCircle2, XCircle, Pencil, Wand2, ShieldAlert, ArrowRight, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  listPendingChangeSets, getChangeSetDetail, approveItem, rejectItem, editThenApprove,
  confirmScopeDimension, resolveConflictOnItem, generateScenariosForItem, applyChangeSetFn,
  listPrecedenceStrategies,
} from "@/lib/review.functions";
import type { ProcessAtom } from "@/types/atom";

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

const OP_META: Record<string, { label: string; symbol: string; tone: string }> = {
  add: { label: "add", symbol: "+", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  modify: { label: "modify", symbol: "~", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  remove: { label: "remove", symbol: "−", tone: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30" },
  no_change: { label: "no change", symbol: "=", tone: "bg-muted text-muted-foreground border-border" },
  conflict_review: { label: "conflict", symbol: "!", tone: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30" },
};

function Page() {
  const fetchList = useServerFn(listPendingChangeSets);
  const { data: sets, isLoading } = useQuery({ queryKey: ["review-sets"], queryFn: () => fetchList() });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <AppShell title="Review" description="Human governance queue for proposed change sets. Approvals are mandatory before atoms become active.">
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading change sets…</div>
      ) : !sets?.length ? (
        <EmptyState icon={ClipboardCheck} title="Nothing to review"
          description="When the pipeline assembles a candidate change set, it appears here for required approvers to accept, amend, or reject." />
      ) : selectedId ? (
        <ChangeSetReview csId={selectedId} onBack={() => setSelectedId(null)} />
      ) : (
        <div className="space-y-2">
          {sets.map((cs) => (
            <Card key={cs.id} className="cursor-pointer hover:border-primary/40 transition" onClick={() => setSelectedId(cs.id)}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <div className="text-sm font-medium">{(cs as { sources?: { title?: string } }).sources?.title ?? "Untitled source"}</div>
                  <div className="text-xs text-muted-foreground">{cs.summary} · {new Date(cs.created_at).toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="text-xs">{cs.total} items</Badge>
                  <Badge variant="outline" className="text-xs">{cs.pending} pending</Badge>
                  {cs.conflict > 0 && <Badge className="bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30 text-xs">{cs.conflict} conflict</Badge>}
                  <Badge variant="secondary" className="text-xs">{cs.status}</Badge>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function ChangeSetReview({ csId, onBack }: { csId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const fetchDetail = useServerFn(getChangeSetDetail);
  const apply = useServerFn(applyChangeSetFn);

  const { data, isLoading } = useQuery({
    queryKey: ["review-detail", csId],
    queryFn: () => fetchDetail({ data: { changeSetId: csId } }),
    refetchInterval: 15_000,
  });

  const applyMut = useMutation({
    mutationFn: () => apply({ data: { changeSetId: csId } }),
    onSuccess: (r) => {
      const res = r as { error?: string; blockers?: { atom_id: string; blocking_fields: string[] }[]; applied?: number; notifications_sent?: number };
      if (res?.error === "publication_blocked") {
        toast.error("Publication blocked", { description: res.blockers?.map((b) => `${b.atom_id}: ${b.blocking_fields.join(", ")}`).join(" · ") });
      } else {
        toast.success(`Published — ${res.applied} atom(s), ${res.notifications_sent} notification(s)`);
      }
      qc.invalidateQueries({ queryKey: ["review-detail", csId] });
      qc.invalidateQueries({ queryKey: ["review-sets"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (!data?.changeSet) return null;

  const approvedCount = data.items.filter((it) => it.review_status === "approved" || it.review_status === "edited_approved").length;
  const applyable = approvedCount > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack}>← Back to queue</Button>
          <div className="mt-1 text-sm text-muted-foreground">
            {(data.changeSet as { sources?: { title?: string; authority_class?: string } }).sources?.title} ·
            <Badge variant="outline" className="ml-2 text-[10px]">{(data.changeSet as { sources?: { authority_class?: string } }).sources?.authority_class}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">{approvedCount} approved</Badge>
          <Button disabled={!applyable || applyMut.isPending} onClick={() => applyMut.mutate()}>
            {applyMut.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Apply approved items
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {data.items.map((item) => (
          <ItemCard key={item.id} item={item as ReviewItem} csId={csId} />
        ))}
      </div>
    </div>
  );
}

interface ReviewItem {
  id: string;
  operation: string | null;
  review_status: string;
  curator_notes: string | null;
  existing_atom: string | null;
  atom_payload: unknown;
  neighbors: unknown[];
  conflict_findings: unknown[];
  scenarios: unknown[];
  reviewed_at: string | null;
}

function ItemCard({ item, csId }: { item: ReviewItem; csId: string }) {
  const qc = useQueryClient();
  const atom = item.atom_payload as ProcessAtom;
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [confirmDim, setConfirmDim] = useState<null | { key: ScopeDimKey; label: string }>(null);
  const op = OP_META[item.operation ?? "add"] ?? OP_META.add;
  const isConflict = item.operation === "conflict_review";
  const decided = item.review_status !== "pending";

  const approve = useServerFn(approveItem);
  const reject = useServerFn(rejectItem);
  const editApprove = useServerFn(editThenApprove);
  const scenarios = useServerFn(generateScenariosForItem);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["review-detail", csId] });
  const approveMut = useMutation({ mutationFn: () => approve({ data: { itemId: item.id } }), onSuccess: () => { toast.success("Approved"); invalidate(); }, onError: (e: Error) => toast.error(e.message) });
  const scenariosMut = useMutation({ mutationFn: () => scenarios({ data: { itemId: item.id } }), onSuccess: () => { toast.success("Scenarios generated"); invalidate(); }, onError: (e: Error) => toast.error(e.message) });

  const conflictFindings = (item.conflict_findings ?? []) as ConflictFinding[];
  const neighborsList = (item.neighbors ?? []) as NeighborRef[];
  const sc = (item.scenarios ?? []) as { situation: string; expected: string }[];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={op.tone + " font-mono text-xs"}>{op.symbol} {op.label}</Badge>
              <CardTitle className="text-base">{atom.identity?.name}</CardTitle>
              <span className="font-mono text-xs text-muted-foreground">{atom.identity?.atom_id}</span>
            </div>
            {item.curator_notes && <div className="mt-1 text-xs text-muted-foreground">{item.curator_notes}</div>}
          </div>
          <div className="flex items-center gap-1">
            {decided ? (
              <Badge variant="secondary" className="text-xs">{item.review_status}</Badge>
            ) : isConflict ? (
              <>
                <Button size="sm" onClick={() => setResolveOpen(true)}><ShieldAlert className="h-3.5 w-3.5 mr-1.5" />Resolve conflict</Button>
                <Button size="sm" variant="outline" onClick={() => setRejectOpen(true)}><XCircle className="h-3.5 w-3.5 mr-1.5" />Reject</Button>
              </>
            ) : (
              <>
                <Button size="sm" onClick={() => approveMut.mutate()} disabled={approveMut.isPending}>
                  {approveMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}><Pencil className="h-3.5 w-3.5 mr-1.5" />Edit</Button>
                <Button size="sm" variant="outline" onClick={() => setRejectOpen(true)}><XCircle className="h-3.5 w-3.5 mr-1.5" />Reject</Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Extracted atom</div>
              <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Show"} 12 components</Button>
            </div>
            {/* Scope confirmation strip */}
            <div className="mb-3 space-y-1.5">
              {(() => {
                type DimKey =
                  | "process" | "activities" | "roles" | "business_objects"
                  | "organizational_scope.company_codes"
                  | "organizational_scope.subsidiaries"
                  | "organizational_scope.plants";
                const top = ["process","activities","roles","business_objects"] as const;
                const org = ["company_codes","subsidiaries","plants"] as const;
                const appAny = atom.applicability as unknown as Record<string, { requires_review?: boolean; status?: string; value?: unknown } | undefined> | undefined;
                const orgScope = appAny?.organizational_scope as unknown as Record<string, { requires_review?: boolean; status?: string; value?: unknown } | undefined> | undefined;
                const rows: { key: DimKey; sv: { requires_review?: boolean; status?: string; value?: unknown } }[] = [];
                for (const k of top) { const sv = appAny?.[k]; if (sv?.requires_review) rows.push({ key: k, sv }); }
                for (const k of org) { const sv = orgScope?.[k]; if (sv?.requires_review) rows.push({ key: `organizational_scope.${k}` as DimKey, sv }); }
                return rows.map(({ key, sv }) => (
                  <Alert key={key} className="py-2">
                    <AlertTitle className="text-xs">Scope requires human confirmation: {key}</AlertTitle>
                    <AlertDescription className="text-xs text-muted-foreground flex items-center justify-between gap-2">
                      <span>Status: <Badge variant="outline" className="text-[10px]">{sv.status}</Badge></span>
                      <Button size="sm" variant="outline" onClick={() => setConfirmDim({ key, label: key })}>Confirm scope</Button>
                    </AlertDescription>
                  </Alert>
                ));
              })()}
            </div>
            {open && <AtomDetail atom={atom} />}
            {!open && atom.provenance?.quoted_evidence?.length > 0 && (
              <div className="rounded border border-border bg-muted/30 p-3">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Evidence</div>
                {atom.provenance.quoted_evidence.slice(0, 3).map((q, i) => (
                  <div key={i} className="text-xs italic mb-1">"{q.text}" <span className="not-italic text-[10px] text-muted-foreground">— {atom.provenance?.section ?? ""} p.{atom.provenance?.page ?? "?"}</span></div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Neighbors from memory ({neighborsList.length})</div>
              {neighborsList.length === 0 ? <div className="text-xs italic text-muted-foreground">No overlapping atoms in current memory.</div> : (
                <ul className="space-y-1">
                  {neighborsList.slice(0, 5).map((n) => (
                    <li key={n.atom_db_id} className="flex items-center justify-between rounded border border-border p-2 text-xs">
                      <span className="font-mono">{n.atom_id} <span className="text-muted-foreground">v{n.version}</span></span>
                      <span className="text-muted-foreground">score {(n.score ?? 0).toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {conflictFindings.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Findings ({conflictFindings.length})</div>
                <ul className="space-y-1">
                  {conflictFindings.map((f, i) => (
                    <li key={i} className={`rounded border p-2 text-xs ${f.verdict === "inconclusive" ? "border-amber-500/40 bg-amber-500/5" : "border-border"}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-mono">{f.neighbor_atom_id}</span>
                        <Badge variant="outline" className={`text-[10px] ${f.verdict === "overlap_conflict" ? "border-red-500/40 text-red-700 dark:text-red-300" : f.verdict === "inconclusive" ? "border-amber-500/40 text-amber-700 dark:text-amber-300" : ""}`}>{f.verdict}</Badge>
                      </div>
                      <div className="mt-1 text-muted-foreground">{f.detail?.reason}</div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        via {f.source}
                        {f.verdict === "inconclusive" && <span className="ml-1 text-amber-700 dark:text-amber-300">· requires human judgment — unknown is never assumed compatible</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <div className="mb-1 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Scenarios</div>
                <Button size="sm" variant="ghost" onClick={() => scenariosMut.mutate()} disabled={scenariosMut.isPending}>
                  {scenariosMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                  {sc.length ? "Regenerate" : "Generate"}
                </Button>
              </div>
              {sc.length === 0 ? <div className="text-xs italic text-muted-foreground">No scenarios yet.</div> : (
                <ul className="space-y-1.5">
                  {sc.map((s, i) => (
                    <li key={i} className="rounded border border-border p-2 text-xs">
                      <div><span className="text-muted-foreground">Situation:</span> {s.situation}</div>
                      <div><span className="text-muted-foreground">Expected:</span> {s.expected}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </CardContent>

      {rejectOpen && <RejectDialog itemId={item.id} onClose={() => { setRejectOpen(false); invalidate(); }} />}
      {editOpen && <EditDialog itemId={item.id} atom={atom} onClose={() => { setEditOpen(false); invalidate(); }} />}
      {resolveOpen && <ResolveDialog itemId={item.id} findings={conflictFindings} onClose={() => { setResolveOpen(false); invalidate(); }} />}
      {confirmDim && <ConfirmScopeDialog itemId={item.id} dim={confirmDim.key} current={readScopeValues(atom, confirmDim.key)} onClose={() => { setConfirmDim(null); invalidate(); }} />}
    </Card>
  );
}

interface NeighborRef { atom_db_id: string; atom_id: string; version: number; score?: number }
interface ConflictFinding { neighbor_atom_id: string; verdict: string; source: string; detail: { reason: string } }

type ScopeDimKey =
  | "process" | "activities" | "roles" | "business_objects"
  | "organizational_scope.company_codes"
  | "organizational_scope.subsidiaries"
  | "organizational_scope.plants";

function readScopeValues(atom: ProcessAtom, key: ScopeDimKey): string[] {
  const app = atom.applicability as unknown as Record<string, { value?: unknown } | undefined> | undefined;
  const raw = key.startsWith("organizational_scope.")
    ? ((app?.organizational_scope as unknown as Record<string, { value?: unknown } | undefined> | undefined)?.[key.split(".")[1]])?.value
    : app?.[key]?.value;
  return Array.isArray(raw) ? (raw as string[]) : [];
}

function RejectDialog({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const reject = useServerFn(rejectItem);
  const m = useMutation({ mutationFn: () => reject({ data: { itemId, reason } }), onSuccess: () => { toast.success("Rejected"); onClose(); }, onError: (e: Error) => toast.error(e.message) });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Reject item</DialogTitle><DialogDescription>Record the reason for the audit trail.</DialogDescription></DialogHeader>
        <Textarea placeholder="Reason…" value={reason} onChange={(e) => setReason(e.target.value)} rows={4} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={!reason || m.isPending} onClick={() => m.mutate()}>Reject</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ itemId, atom, onClose }: { itemId: string; atom: ProcessAtom; onClose: () => void }) {
  const [text, setText] = useState(JSON.stringify(atom, null, 2));
  const [err, setErr] = useState<string | null>(null);
  const edit = useServerFn(editThenApprove);
  const m = useMutation({
    mutationFn: () => {
      try {
        const parsed = JSON.parse(text);
        return edit({ data: { itemId, atom_payload: parsed } });
      } catch (e) {
        return Promise.reject(new Error("Invalid JSON: " + (e as Error).message));
      }
    },
    onSuccess: () => { toast.success("Edited and approved"); onClose(); },
    onError: (e: Error) => setErr(e.message),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Edit atom, then approve</DialogTitle>
          <DialogDescription>Full 12-component JSON. Changes are recorded in the audit trail.</DialogDescription></DialogHeader>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={22} className="font-mono text-xs" />
        {err && <div className="text-xs text-destructive">{err}</div>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={m.isPending} onClick={() => m.mutate()}>Save & Approve</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmScopeDialog({ itemId, dim, current, onClose }: { itemId: string; dim: ScopeDimKey; current: string[]; onClose: () => void }) {
  const [values, setValues] = useState(current.join(", "));
  const [status, setStatus] = useState<"explicit" | "inherited" | "inferred" | "not_stated">("explicit");
  const confirm = useServerFn(confirmScopeDimension);
  const m = useMutation({
    mutationFn: () => {
      const arr = status === "not_stated" ? null : values.split(",").map((s) => s.trim()).filter(Boolean);
      return confirm({ data: { itemId, dimension: dim, value: arr, status } });
    },
    onSuccess: () => { toast.success("Scope confirmed"); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Confirm scope — {dim}</DialogTitle>
          <DialogDescription>Human confirmation clears requires_review and is recorded in the audit trail. "not_stated" is preserved — never widened to universal.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div>
            <div className="text-xs mb-1">Values (comma-separated)</div>
            <Input value={values} onChange={(e) => setValues(e.target.value)} disabled={status === "not_stated"} />
          </div>
          <div>
            <div className="text-xs mb-1">Derivation status</div>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="explicit">explicit</SelectItem>
                <SelectItem value="inherited">inherited (from heading/section)</SelectItem>
                <SelectItem value="inferred">inferred</SelectItem>
                <SelectItem value="not_stated">not_stated (leave blank)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={m.isPending} onClick={() => m.mutate()}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResolveDialog({ itemId, findings, onClose }: { itemId: string; findings: ConflictFinding[]; onClose: () => void }) {
  const conflict = findings.find((f) => f.verdict === "overlap_conflict");
  const fetchStrategies = useServerFn(listPrecedenceStrategies);
  const { data: strategies } = useQuery({ queryKey: ["precedence"], queryFn: () => fetchStrategies() });
  const [strategy, setStrategy] = useState<string>("");
  const [winning, setWinning] = useState<"draft" | "existing">("draft");
  const [reason, setReason] = useState("");
  const resolve = useServerFn(resolveConflictOnItem);
  const m = useMutation({
    mutationFn: () => resolve({ data: { itemId, strategy, winning, reason } }),
    onSuccess: () => { toast.success("Conflict resolved"); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const recommended = useMemo(() => (strategies?.[0] as { name?: string })?.name ?? "", [strategies]);
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Resolve conflict</DialogTitle>
          <DialogDescription>Requires policy_owner. Only strategies enabled by your organization are shown.</DialogDescription></DialogHeader>
        {conflict && (
          <Alert>
            <AlertTitle className="text-sm">Conflict with {conflict.neighbor_atom_id}</AlertTitle>
            <AlertDescription className="text-xs">{conflict.detail.reason}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-3">
          <div>
            <div className="text-xs mb-1">Precedence strategy {recommended && <span className="text-muted-foreground">(recommended: {recommended})</span>}</div>
            <Select value={strategy} onValueChange={setStrategy}>
              <SelectTrigger><SelectValue placeholder={strategies?.length ? "Choose…" : "No strategies enabled"} /></SelectTrigger>
              <SelectContent>
                {(strategies ?? []).map((s) => <SelectItem key={(s as { name: string }).name} value={(s as { name: string }).name}>{(s as { name: string }).name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-xs mb-1">Winning atom</div>
            <Select value={winning} onValueChange={(v) => setWinning(v as "draft" | "existing")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft (new) atom wins — supersedes existing</SelectItem>
                <SelectItem value="existing">Existing atom wins — draft rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-xs mb-1">Reason</div>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!strategy || !reason || m.isPending} onClick={() => m.mutate()}>Resolve</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
