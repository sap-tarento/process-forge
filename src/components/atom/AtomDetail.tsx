import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type {
  ProcessAtom,
  AtomApplicability,
  AtomAction,
  ScopedValue,
  ValidationResult,
  RelationshipType,
} from "@/types/atom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScopeBadge, ModalityBadge, LifecycleBadge } from "./AtomStatusBadge";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </CardHeader>
      <CardContent className="text-sm">{children}</CardContent>
    </Card>
  );
}

function ScopeRow({ label, sv }: { label: string; sv: ScopedValue | undefined }) {
  const s = sv ?? { value: null, status: "not_stated" as const, requires_review: true };
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/50 py-1.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-sm">
          {s.value && s.value.length ? (
            <div className="flex flex-wrap gap-1">
              {s.value.map((v) => (
                <Badge key={v} variant="secondary" className="font-mono text-[10px]">{v}</Badge>
              ))}
            </div>
          ) : (
            <span className="italic text-muted-foreground">not stated</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 pt-1">
        {s.requires_review && (
          <AlertCircle className="h-3.5 w-3.5 text-amber-500" aria-label="Requires review" />
        )}
        <ScopeBadge status={s.status} />
      </div>
    </div>
  );
}

function ActionCard({ action, depth = 0 }: { action: AtomAction; depth?: number }) {
  return (
    <div className={`rounded-md border border-border p-3 ${depth > 0 ? "ml-4 mt-2 bg-muted/30" : "bg-card"}`}>
      <div className="flex items-center gap-2">
        <ModalityBadge modality={action.modality} />
        <span className="text-sm">
          <strong>{action.actor || "—"}</strong> {action.operation} <strong>{action.object || "—"}</strong>
          {action.target ? <> → {action.target}</> : null}
        </span>
      </div>
      {(action.deadline || action.timing) && (
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          {action.deadline && <>Deadline: {action.deadline} </>}
          {action.timing && <>· {action.timing}</>}
        </div>
      )}
      {action.parameters && Object.keys(action.parameters).length > 0 && (
        <pre className="mt-2 overflow-x-auto rounded bg-muted/40 p-2 font-mono text-[10px] text-muted-foreground">
          {JSON.stringify(action.parameters, null, 2)}
        </pre>
      )}
      {(action.on_noncompliance ?? []).length > 0 && (
        <div className="mt-2">
          <div className="text-[11px] uppercase tracking-wider text-destructive">On non-compliance</div>
          {action.on_noncompliance.map((child, i) => (
            <ActionCard key={i} action={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function ApplicabilityView({ app }: { app: AtomApplicability }) {
  return (
    <div className="space-y-1">
      <ScopeRow label="Process" sv={app.process} />
      <ScopeRow label="Activities" sv={app.activities} />
      <ScopeRow label="Roles" sv={app.roles} />
      <ScopeRow label="Business objects" sv={app.business_objects} />
      <div className="border-b border-border/50 py-1.5">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Organizational scope</div>
        <div className="mt-1 grid gap-1 pl-3">
          <ScopeRow label="Company codes" sv={app.organizational_scope?.company_codes} />
          <ScopeRow label="Subsidiaries" sv={app.organizational_scope?.subsidiaries} />
          <ScopeRow label="Plants" sv={app.organizational_scope?.plants} />
        </div>
      </div>
      <div className="py-1.5">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Preconditions</div>
        {(app.preconditions ?? []).length === 0 ? (
          <div className="mt-1 text-[11px] italic text-muted-foreground">none</div>
        ) : (
          <ul className="mt-1 space-y-1 font-mono text-[11px]">
            {app.preconditions.map((p, i) => (
              <li key={i} className="rounded bg-muted/40 px-2 py-1">
                <span className="text-primary">{p.field}</span> {p.operator}{" "}
                <span className="text-foreground">{JSON.stringify(p.value)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="py-1.5">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Exceptions</div>
        {(app.exceptions ?? []).length === 0 ? (
          <div className="mt-1 text-[11px] italic text-muted-foreground">none</div>
        ) : (
          <ul className="mt-1 space-y-1 font-mono text-[11px]">
            {app.exceptions.map((p, i) => (
              <li key={i} className="rounded bg-muted/40 px-2 py-1">
                <span className="text-primary">{p.field}</span> {p.operator} {JSON.stringify(p.value)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ValidationList({ results }: { results: ValidationResult[] }) {
  if (!results?.length) return <div className="text-[11px] italic text-muted-foreground">Not yet validated.</div>;
  return (
    <ul className="space-y-2">
      {results.map((r) => (
        <li key={r.layer} className="rounded-md border border-border p-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              {r.passed ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-destructive" />
              )}
              {r.layer.replace("_", " ")}
            </div>
            {typeof r.score === "number" && (
              <span className="font-mono text-[11px] text-muted-foreground">{Math.round(r.score * 100)}%</span>
            )}
          </div>
          {r.issues?.length > 0 && (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
              {r.issues.slice(0, 6).map((i, idx) => <li key={idx}>{i}</li>)}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AtomDetail({ atom, relationships }: {
  atom: ProcessAtom;
  relationships?: { id: string; relationship_type: RelationshipType; to_atom_id: string; rationale: string | null }[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Identity & lifecycle">
        <div className="space-y-2">
          <div>
            <div className="font-mono text-xs text-primary">{atom.identity.atom_id}</div>
            <div className="text-base font-semibold">{atom.identity.name}</div>
          </div>
          <div className="flex items-center gap-2">
            <LifecycleBadge status={atom.version.status} />
            <Badge variant="outline" className="font-mono text-[10px]">v{atom.version.version}</Badge>
            <Badge variant="secondary" className="text-[10px]">{atom.knowledge_type}</Badge>
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            <div>valid_from: {atom.version.valid_from ?? "—"}</div>
            <div>valid_to: {atom.version.valid_to ?? "—"}</div>
            <div>transaction_time: {atom.version.transaction_time}</div>
          </div>
        </div>
      </Section>

      <Section title="Action" hint="What the atom obliges, prohibits, or permits">
        <ActionCard action={atom.action} />
      </Section>

      <Section title="Applicability (Φ)" hint="When this atom fires at runtime">
        <ApplicabilityView app={atom.applicability} />
      </Section>

      <Section title="Purpose" hint="Descriptive — not execution-authoritative">
        <p className="text-sm">{atom.purpose?.text || <span className="italic text-muted-foreground">not stated</span>}</p>
        <div className="mt-2 flex items-center gap-2 text-[11px]">
          <Badge variant="outline" className="text-[10px]">derivation: {atom.purpose?.derivation ?? "—"}</Badge>
          {typeof atom.purpose?.confidence === "number" && (
            <span className="text-muted-foreground">confidence {Math.round(atom.purpose.confidence * 100)}%</span>
          )}
          <span className="text-muted-foreground">· not execution-authoritative</span>
        </div>
      </Section>

      <Section title="Domain tags" hint="Enterprise domain grounding (Stage 7)">
        <div className="space-y-2">
          {Object.entries(atom.domain_tags ?? {}).map(([cat, values]) => (
            <div key={cat} className="flex items-start gap-2">
              <div className="w-40 shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground">
                {cat.replace(/_/g, " ")}
              </div>
              <div className="flex flex-wrap gap-1">
                {(values as string[]).length === 0 ? (
                  <span className="text-[11px] italic text-muted-foreground">—</span>
                ) : (
                  (values as string[]).map((v) => (
                    <Badge key={v} variant="secondary" className="font-mono text-[10px]">{v}</Badge>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Provenance">
        <div className="space-y-2 text-sm">
          <div className="text-[11px] text-muted-foreground">
            {atom.provenance?.source_title} · {atom.provenance?.source_type} · v{atom.provenance?.source_version}
          </div>
          <div className="text-[11px] text-muted-foreground">
            page {atom.provenance?.page ?? "—"} · {atom.provenance?.section ?? "—"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            model: {atom.provenance?.extraction_model} · prompt: {atom.provenance?.extraction_prompt_version} · parser: {atom.provenance?.parser_version}
          </div>
          <div className="mt-2">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Quoted evidence</div>
            <ul className="mt-1 space-y-1.5">
              {(atom.provenance?.quoted_evidence ?? []).map((q, i) => (
                <li key={i} className="rounded border border-border bg-muted/30 p-2 text-xs italic">
                  “{q.text}”
                  <span className="ml-2 text-[10px] text-muted-foreground not-italic">
                    {q.character_start !== undefined ? `chars ${q.character_start}-${q.character_end}` : "unresolved"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-1 font-mono text-[10px] text-muted-foreground">
            hash: {atom.provenance?.source_text_hash?.slice(0, 16)}…
          </div>
        </div>
      </Section>

      <Section title="Governance">
        <div className="grid gap-1 text-sm">
          <div><span className="text-muted-foreground">Owner:</span> {atom.governance?.owner || "—"}</div>
          <div>
            <span className="text-muted-foreground">Authority:</span>{" "}
            <Badge variant="outline" className="text-[10px]">{atom.governance?.authority_level || "—"}</Badge>
          </div>
          <div>
            <span className="text-muted-foreground">Required approvers:</span>{" "}
            {(atom.governance?.required_approvers ?? []).join(", ") || "—"}
          </div>
        </div>
      </Section>

      <Section title="Relationships">
        {(relationships ?? []).length === 0 ? (
          <div className="text-[11px] italic text-muted-foreground">No typed relationships yet.</div>
        ) : (
          <ul className="space-y-1">
            {relationships!.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded border border-border p-2 text-xs">
                <Badge variant="outline" className="font-mono text-[10px]">{r.relationship_type}</Badge>
                <span className="font-mono">{r.to_atom_id}</span>
                {r.rationale && <span className="text-muted-foreground">— {r.rationale}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Quality" hint="4 validation layers (Stage 9)">
        <div className="mb-3 grid gap-2 text-xs">
          <ConfBar label="Action confidence" v={atom.quality?.action_confidence} />
          <ConfBar label="Applicability confidence" v={atom.quality?.applicability_confidence} />
          <ConfBar label="Purpose confidence" v={atom.quality?.purpose_confidence} />
          <ConfBar label="Atomicity score" v={atom.quality?.atomicity_score} />
        </div>
        <ValidationList results={atom.quality?.validations ?? []} />
      </Section>
    </div>
  );
}

function ConfBar({ label, v }: { label: string; v: number | undefined }) {
  const pct = Math.max(0, Math.min(100, Math.round((v ?? 0) * 100)));
  return (
    <div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{label}</span><span className="font-mono">{pct}%</span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}

export function useAtomRelationships(atomDbId: string | undefined) {
  return useQuery({
    queryKey: ["atom-relationships", atomDbId],
    enabled: !!atomDbId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("atom_relationships")
        .select("id, relationship_type, to_atom_id, rationale")
        .eq("from_atom", atomDbId!);
      if (error) throw error;
      return data;
    },
  });
}

export function ExternalLinkIcon() {
  return <ExternalLink className="h-3 w-3" />;
}