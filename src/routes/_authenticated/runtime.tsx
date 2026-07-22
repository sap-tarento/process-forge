import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/layout/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { Play, ChevronDown, ChevronRight, AlertCircle, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { retrieveAtomsFn, asRetrievalResult } from "@/lib/runtime.functions";
import type { RetrievalResult, StepRecord } from "@/lib/runtime.functions";

export const Route = createFileRoute("/_authenticated/runtime")({
  head: () => ({
    meta: [
      { title: "Runtime — AtomForge" },
      { name: "description", content: "Simulate an agent context request against the current atom memory. Inspect the paper's 8-step retrieval trace." },
      { property: "og:title", content: "Runtime — AtomForge" },
      { property: "og:description", content: "Simulate an agent context request against the current atom memory." },
    ],
  }),
  component: Page,
});

interface FormState {
  process: string; activity: string; role: string; organizational_unit: string; business_object: string;
  attributes_text: string; case_state_text: string; as_of_time: string;
}

function useVocabulary() {
  return useQuery({
    queryKey: ["domain-model-runtime"],
    queryFn: async () => {
      const { data, error } = await supabase.from("domain_model").select("category, value, label").order("category").order("label");
      if (error) throw error;
      return (data ?? []) as { category: string; value: string; label: string }[];
    },
  });
}

function Page() {
  const { data: vocab } = useVocabulary();
  const [form, setForm] = useState<FormState>({
    process: "purchase-to-pay", activity: "submit-purchase-requisition", role: "requester",
    organizational_unit: "", business_object: "purchase_requisition",
    attributes_text: `{\n  "purchase_requisition.category": "medical_equipment",\n  "invoice.deviation_eur": 320\n}`,
    case_state_text: "{}",
    as_of_time: "",
  });
  const [result, setResult] = useState<RetrievalResult | null>(null);

  const fn = useServerFn(retrieveAtomsFn);
  const mut = useMutation({
    mutationFn: async () => {
      let attrs: Record<string, unknown> = {};
      let cstate: Record<string, unknown> = {};
      try { if (form.attributes_text.trim()) attrs = JSON.parse(form.attributes_text); }
      catch { throw new Error("business_object_attributes is not valid JSON"); }
      try { if (form.case_state_text.trim()) cstate = JSON.parse(form.case_state_text); }
      catch { throw new Error("case_state is not valid JSON"); }
      return await fn({ data: {
        process: form.process || null, activity: form.activity || null, role: form.role || null,
        organizational_unit: form.organizational_unit || null, business_object: form.business_object || null,
        business_object_attributes: attrs, case_state: cstate,
        as_of_time: form.as_of_time || null,
      } });
    },
    onSuccess: (r) => { setResult(asRetrievalResult(r)); },
    onError: (e: Error) => toast.error(e.message),
  });

  const byCategory = (cat: string) => (vocab ?? []).filter((v) => v.category === cat);

  const Datalist = ({ id, cat }: { id: string; cat: string }) => (
    <datalist id={id}>{byCategory(cat).map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}</datalist>
  );

  return (
    <AppShell title="Runtime" description="Simulate an agent context request against the current atom memory.">
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader><CardTitle className="text-sm">Context request</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Field label="Process"><Input list="dl-process" className="h-8 text-xs font-mono" value={form.process} onChange={(e) => setForm({ ...form, process: e.target.value })} /></Field>
            <Datalist id="dl-process" cat="process" />
            <Field label="Activity"><Input list="dl-activity" className="h-8 text-xs font-mono" value={form.activity} onChange={(e) => setForm({ ...form, activity: e.target.value })} /></Field>
            <Datalist id="dl-activity" cat="activity" />
            <Field label="Role"><Input list="dl-role" className="h-8 text-xs font-mono" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></Field>
            <Datalist id="dl-role" cat="role" />
            <Field label="Business object"><Input list="dl-bo" className="h-8 text-xs font-mono" value={form.business_object} onChange={(e) => setForm({ ...form, business_object: e.target.value })} /></Field>
            <Datalist id="dl-bo" cat="business_object" />
            <Field label="Organizational unit"><Input list="dl-ou" className="h-8 text-xs font-mono" value={form.organizational_unit} onChange={(e) => setForm({ ...form, organizational_unit: e.target.value })} /></Field>
            <Datalist id="dl-ou" cat="organizational_unit" />
            <Field label="business_object_attributes (JSON)">
              <Textarea rows={5} className="text-xs font-mono" value={form.attributes_text} onChange={(e) => setForm({ ...form, attributes_text: e.target.value })} />
            </Field>
            <Field label="case_state (JSON)">
              <Textarea rows={2} className="text-xs font-mono" value={form.case_state_text} onChange={(e) => setForm({ ...form, case_state_text: e.target.value })} />
            </Field>
            <Field label="as_of_time (ISO, optional)">
              <Input className="h-8 text-xs font-mono" placeholder="2026-01-01T00:00:00Z" value={form.as_of_time} onChange={(e) => setForm({ ...form, as_of_time: e.target.value })} />
            </Field>
            <Button onClick={() => mut.mutate()} disabled={mut.isPending} className="w-full">
              <Play className="mr-1.5 h-3.5 w-3.5" /> {mut.isPending ? "Retrieving…" : "Retrieve"}
            </Button>
            <div className="mt-3 rounded border border-border/60 bg-muted/30 p-2 text-[11px] text-muted-foreground">
              Also available as an HTTP endpoint — <span className="font-mono">POST /api/public/retrieve</span> with the same JSON body.
              Set the <span className="font-mono">ATOMFORGE_RUNTIME_TOKEN</span> secret to require a bearer token.
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {!result ? (
            <EmptyState icon={Play} title="No retrieval yet" description="Compose a context request and press Retrieve to see the paper's 8-step pipeline with inspectable intermediate results." />
          ) : (
            <>
              <StepsTrace steps={result.steps} />
              <RankedAtoms result={result} />
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function StepsTrace({ steps }: { steps: StepRecord[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">8-step retrieval trace</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {steps.map((s) => <StepRow key={s.step} step={s} />)}
      </CardContent>
    </Card>
  );
}

function StepRow({ step }: { step: StepRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center gap-3 rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <div className="flex-1">
            <div className="text-xs font-medium">{step.label}</div>
            <div className="text-[11px] text-muted-foreground">{step.notes.join(" · ")}</div>
          </div>
          <Badge variant="outline" className="font-mono text-[10px]">in {step.in_count} → out {step.out_count}</Badge>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-6 mt-2 space-y-2 text-xs">
          {step.excluded && step.excluded.length > 0 && (
            <div>
              <div className="mb-1 font-medium text-foreground">Excluded ({step.excluded.length})</div>
              <ul className="space-y-1">
                {step.excluded.map((e, i) => (
                  <li key={i} className="flex items-start gap-2 rounded bg-muted/40 p-1.5">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    <div><span className="font-mono">{e.atom_id}</span> — <span className="text-muted-foreground">{e.reason}</span></div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {step.detail && (
            <pre className="max-h-64 overflow-auto rounded bg-muted/40 p-2 font-mono text-[11px]">{JSON.stringify(step.detail, null, 2)}</pre>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function RankedAtoms({ result }: { result: RetrievalResult }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Ranked atoms ({result.atoms.length})
          <span className="ml-auto text-[11px] font-normal text-muted-foreground">memory generation {result.memory_generation ?? "—"}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {result.atoms.length === 0 ? (
          <div className="rounded border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            No atoms matched this context. Load the demo scenario in Settings, or ingest and compile sources first.
          </div>
        ) : (
          <ul className="space-y-3">
            {result.atoms.map((a) => (
              <li key={a.atom_id} className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-start gap-2">
                  <ModalityBadge modality={a.modality} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Link to="/atoms/$id" params={{ id: a.atom_db_id }} className="text-sm font-medium hover:underline">{a.name}</Link>
                      <Badge variant="outline" className="font-mono text-[10px]">{a.atom_id} · v{a.version}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{a.knowledge_type}</span> · <span>authority {a.authority_level}</span> · <span>score {a.score.toFixed(2)}</span>
                      {a.scope_uncertain && (
                        <Badge variant="destructive" className="text-[10px]">scope uncertain — verify [{a.uncertain_dimensions.join(", ")}]</Badge>
                      )}
                      {a.reasons.relationship_pull && (
                        <Badge variant="secondary" className="text-[10px]">{a.reasons.relationship_pull.type} via {a.reasons.relationship_pull.from_atom_id}</Badge>
                      )}
                    </div>
                    {a.reasons.matched_dimensions.length > 0 && (
                      <div className="mt-1 text-[11px] text-muted-foreground">matched: {a.reasons.matched_dimensions.join(", ")}</div>
                    )}
                    {a.reasons.predicate_results.length > 0 && (
                      <details className="mt-1 text-[11px]">
                        <summary className="cursor-pointer text-muted-foreground">predicate results</summary>
                        <ul className="mt-1 space-y-0.5">
                          {a.reasons.predicate_results.map((p, i) => (
                            <li key={i} className="font-mono">
                              <span className={p.passed ? "text-emerald-600" : "text-destructive"}>{p.passed ? "✓" : "✗"}</span>{" "}
                              {p.field} {p.operator} — {p.reason ?? ""}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ModalityBadge({ modality }: { modality: string }) {
  const map: Record<string, string> = {
    MUST: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-200",
    MUST_NOT: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-200",
    MAY: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-200",
  };
  return <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] ${map[modality] ?? "bg-muted"}`}>{modality}</span>;
}
