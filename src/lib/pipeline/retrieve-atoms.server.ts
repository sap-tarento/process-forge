/**
 * AtomForge — Runtime retrieval pipeline (paper's 8 steps).
 *
 *   1. Resolve request → enterprise-domain concepts (domain_model).
 *   2. Mandatory global atoms (explicitly universal — never not_stated).
 *   3. Filter by process / activity / business object / role / org scope.
 *   4. Evaluate deterministic Φ preconditions against context attributes.
 *   5. Semantic rerank inside the filtered set (embeddings, when available).
 *   6. Add DEPENDS_ON / EXCEPTION_TO neighbours of the surviving set.
 *   7. Resolve superseded / conflicting versions (bitemporal + precedence).
 *   8. Rerank by necessity (MUST first) and authority.
 *
 * Not_stated is never universal: dimensions with `not_stated` include the atom
 * but mark it "scope uncertain — verify".
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ProcessAtom, Precondition, PreconditionOperator, ScopedValue, ActionModality, AuthorityLevel } from "@/types/atom";
import { rowToAtom } from "@/lib/atom-mapper";

type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | JsonValue[] | { [k: string]: JsonValue };

export interface RetrievalContext {
  process?: string | null;
  activity?: string | null;
  role?: string | null;
  organizational_unit?: string | null;
  business_object?: string | null;
  business_object_attributes?: Record<string, JsonValue>;
  case_state?: Record<string, JsonValue>;
  as_of_time?: string | null;
}

export type StepKey =
  | "resolve_concepts"
  | "mandatory_global"
  | "scope_filter"
  | "predicate_evaluation"
  | "semantic_rerank"
  | "dependents_and_exceptions"
  | "version_and_precedence"
  | "necessity_authority_rerank";

export interface StepRecord {
  step: StepKey;
  label: string;
  in_count: number;
  out_count: number;
  notes: string[];
  excluded?: { atom_id: string; reason: string }[];
  detail?: Record<string, JsonValue>;
}

export interface RetrievedAtom {
  atom_db_id: string;
  atom_id: string;
  name: string;
  version: number;
  knowledge_type: ProcessAtom["knowledge_type"];
  modality: ActionModality;
  authority_level: AuthorityLevel;
  scope_uncertain: boolean;
  uncertain_dimensions: string[];
  score: number;
  reasons: {
    matched_dimensions: string[];
    predicate_results: { field: string; operator: string; passed: boolean; reason?: string }[];
    semantic_score: number;
    relationship_pull?: { type: string; from_atom_id: string };
    precedence_note?: string;
  };
  atom: ProcessAtom;
}

export interface RetrievalResult {
  resolved_context: RetrievalContext & { resolved_terms: Record<string, string | null> };
  memory_generation: number | null;
  steps: StepRecord[];
  atoms: RetrievedAtom[];
}

// ────────────────────────────────────────────────────────────────────────────

const STEP_LABELS: Record<StepKey, string> = {
  resolve_concepts: "1 · Resolve request to enterprise-domain concepts",
  mandatory_global: "2 · Retrieve mandatory global atoms",
  scope_filter: "3 · Filter by process / activity / business object / role / org",
  predicate_evaluation: "4 · Evaluate deterministic applicability predicates",
  semantic_rerank: "5 · Semantic rerank inside the filtered set",
  dependents_and_exceptions: "6 · Pull DEPENDS_ON + EXCEPTION_TO neighbours",
  version_and_precedence: "7 · Resolve versions & conflicts (precedence)",
  necessity_authority_rerank: "8 · Rerank by necessity and authority",
};

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}
function scopeIncludes(sv: ScopedValue | undefined, term: string | null | undefined): { match: boolean; uncertain: boolean } {
  if (!sv) return { match: false, uncertain: false };
  if (sv.status === "not_stated") return { match: true, uncertain: true };
  const t = norm(term);
  if (!t) return { match: true, uncertain: false };
  const values = (sv.value ?? []).map((v) => norm(String(v)));
  if (values.includes("*")) return { match: true, uncertain: false };
  return { match: values.includes(t), uncertain: false };
}
function isExplicitlyUniversal(sv: ScopedValue | undefined): boolean {
  if (!sv || sv.status === "not_stated") return false;
  const values = (sv.value ?? []).map((v) => norm(String(v)));
  return values.includes("*");
}

function evalPrecondition(pc: Precondition, ctx: Record<string, unknown>): { passed: boolean; reason?: string } {
  const path = pc.field.split(".");
  let v: unknown = ctx;
  for (const p of path) v = v == null ? undefined : (v as Record<string, unknown>)[p];
  const rhs = pc.value;
  const op: PreconditionOperator = pc.operator;
  const num = (x: unknown) => (typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN);
  switch (op) {
    case "EXISTS":
      return { passed: v !== undefined && v !== null && v !== "", reason: `value=${JSON.stringify(v)}` };
    case "EQUALS":
      return { passed: String(v ?? "") === String(rhs ?? ""), reason: `got ${JSON.stringify(v)} vs ${JSON.stringify(rhs)}` };
    case "IN": {
      const arr = Array.isArray(rhs) ? rhs.map(String) : [String(rhs)];
      return { passed: arr.includes(String(v ?? "")), reason: `got ${JSON.stringify(v)}` };
    }
    case "NOT_IN": {
      const arr = Array.isArray(rhs) ? rhs.map(String) : [String(rhs)];
      return { passed: !arr.includes(String(v ?? "")), reason: `got ${JSON.stringify(v)}` };
    }
    case "GT": return { passed: num(v) > num(rhs), reason: `${v} > ${String(rhs)}` };
    case "GTE": return { passed: num(v) >= num(rhs), reason: `${v} >= ${String(rhs)}` };
    case "LT": return { passed: num(v) < num(rhs), reason: `${v} < ${String(rhs)}` };
    case "LTE": return { passed: num(v) <= num(rhs), reason: `${v} <= ${String(rhs)}` };
    default: return { passed: false, reason: `unknown operator ${op}` };
  }
}

function cosine(a: number[] | null, b: number[] | null): number {
  if (!a || !b || a.length !== b.length) return 0;
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function modalityWeight(m: ActionModality): number {
  return m === "MUST" || m === "MUST_NOT" ? 2 : 1;
}
function authorityWeight(a: AuthorityLevel | undefined): number {
  const map: Record<AuthorityLevel, number> = {
    regulatory: 5, board: 4, executive: 3, functional: 2, local: 1,
  };
  return a ? map[a] : 1;
}

// ────────────────────────────────────────────────────────────────────────────

export async function retrieveAtoms(
  admin: SupabaseClient<Database>,
  ctx: RetrievalContext,
): Promise<RetrievalResult> {
  const steps: StepRecord[] = [];
  const asOf = ctx.as_of_time ? new Date(ctx.as_of_time) : new Date();

  // Step 1 — resolve to domain concepts
  const { data: domainRows } = await admin.from("domain_model").select("category, value, label");
  const vocab = (domainRows ?? []) as { category: string; value: string; label: string }[];
  const resolveTerm = (term: string | null | undefined, category: string): string | null => {
    if (!term) return null;
    const t = norm(term);
    const inCat = vocab.filter((v) => v.category === category);
    const exact = inCat.find((v) => norm(v.value) === t || norm(v.label) === t);
    if (exact) return exact.value;
    const partial = inCat.find((v) => norm(v.label).includes(t) || norm(v.value).includes(t) || t.includes(norm(v.value)));
    return partial ? partial.value : term;
  };
  const resolved: RetrievalContext & { resolved_terms: Record<string, string | null> } = {
    ...ctx,
    process: resolveTerm(ctx.process, "process"),
    activity: resolveTerm(ctx.activity, "activity"),
    role: resolveTerm(ctx.role, "role"),
    organizational_unit: resolveTerm(ctx.organizational_unit, "organizational_unit"),
    business_object: resolveTerm(ctx.business_object, "business_object"),
    resolved_terms: {
      process: resolveTerm(ctx.process, "process"),
      activity: resolveTerm(ctx.activity, "activity"),
      role: resolveTerm(ctx.role, "role"),
      organizational_unit: resolveTerm(ctx.organizational_unit, "organizational_unit"),
      business_object: resolveTerm(ctx.business_object, "business_object"),
    },
  };
  steps.push({
    step: "resolve_concepts", label: STEP_LABELS.resolve_concepts,
    in_count: 0, out_count: Object.values(resolved.resolved_terms).filter(Boolean).length,
    notes: [
      `Matched ${Object.values(resolved.resolved_terms).filter(Boolean).length} of ${Object.values(ctx).filter((v) => typeof v === "string" && v).length} request terms against domain vocabulary.`,
    ],
    excluded: [],
    detail: { resolved_terms: resolved.resolved_terms, vocabulary_size: vocab.length },
  });

  // Load candidate universe = active atoms, latest version per atom_id, valid at asOf
  const { data: rawRows } = await admin
    .from("atoms")
    .select("id, atom_id, name, version, status, transaction_time, valid_from, valid_to, knowledge_type, applicability, action, purpose, domain_tags, provenance, governance, quality, processes, activities, roles, business_objects, embedding")
    .eq("status", "active");
  const rows = (rawRows ?? []) as Array<{ id: string; atom_id: string; version: number; valid_from: string | null; valid_to: string | null; embedding: number[] | string | null } & Record<string, unknown>>;
  const validAtT = rows.filter((r) => {
    const vf = r.valid_from ? new Date(r.valid_from) : null;
    const vt = r.valid_to ? new Date(r.valid_to) : null;
    if (vf && asOf < vf) return false;
    if (vt && asOf >= vt) return false;
    return true;
  });
  const byLineage = new Map<string, typeof validAtT[number]>();
  for (const r of validAtT) {
    const p = byLineage.get(r.atom_id);
    if (!p || r.version > p.version) byLineage.set(r.atom_id, r);
  }
  const universe = Array.from(byLineage.values()).map((r) => {
    const atom = rowToAtom(r as never);
    const emb = Array.isArray(r.embedding) ? (r.embedding as number[]) : null;
    return { row: r, atom, embedding: emb };
  });

  // Step 2 — mandatory global atoms
  const mandatory = universe.filter(({ atom }) => isExplicitlyUniversal(atom.applicability?.process));
  steps.push({
    step: "mandatory_global", label: STEP_LABELS.mandatory_global,
    in_count: universe.length, out_count: mandatory.length,
    notes: mandatory.length
      ? [`${mandatory.length} atom(s) declare explicit universal process scope.`]
      : [`No atoms with explicit universal (*) process scope — not_stated is never widened to universal.`],
    excluded: [], detail: { atom_ids: mandatory.map((m) => m.atom.identity.atom_id) },
  });

  // Step 3 — scope filter
  const scopeExcluded: { atom_id: string; reason: string }[] = [];
  interface Cand { row: (typeof universe)[number]["row"]; atom: ProcessAtom; embedding: number[] | null; matched: string[]; uncertain: string[] }
  const scoped: Cand[] = [];
  for (const u of universe) {
    if (mandatory.includes(u)) continue;
    const dims: Array<[string, ScopedValue | undefined, string | null | undefined]> = [
      ["process", u.atom.applicability?.process, resolved.process],
      ["activity", u.atom.applicability?.activities, resolved.activity],
      ["business_object", u.atom.applicability?.business_objects, resolved.business_object],
      ["role", u.atom.applicability?.roles, resolved.role],
    ];
    let ok = true;
    const matched: string[] = [];
    const uncertain: string[] = [];
    for (const [name, sv, term] of dims) {
      if (!term) continue;
      const r = scopeIncludes(sv, term);
      if (!r.match) { ok = false; scopeExcluded.push({ atom_id: u.atom.identity.atom_id, reason: `${name} scope excludes "${term}"` }); break; }
      if (r.uncertain) uncertain.push(name);
      else matched.push(name);
    }
    if (ok) scoped.push({ ...u, matched, uncertain });
  }
  steps.push({
    step: "scope_filter", label: STEP_LABELS.scope_filter,
    in_count: universe.length - mandatory.length, out_count: scoped.length,
    notes: [`Filtered to ${scoped.length} atom(s). Not_stated dimensions include the atom but flag "scope uncertain".`],
    excluded: scopeExcluded.slice(0, 25),
  });

  // Step 4 — predicate evaluation
  const predExcluded: { atom_id: string; reason: string }[] = [];
  const predResults = new Map<string, { field: string; operator: string; passed: boolean; reason?: string }[]>();
  const ctxForPred = { ...(ctx.business_object_attributes ?? {}), ...(ctx.case_state ?? {}) };
  const afterPred: Cand[] = [];
  for (const c of scoped) {
    const results = (c.atom.applicability?.preconditions ?? []).map((pc) => {
      const r = evalPrecondition(pc, ctxForPred);
      return { field: pc.field, operator: pc.operator, passed: r.passed, reason: r.reason };
    });
    predResults.set(c.atom.identity.atom_id, results);
    // Exceptions: if any exception precondition is true, drop.
    const exceptions = (c.atom.applicability?.exceptions ?? []).map((pc) => evalPrecondition(pc, ctxForPred));
    if (exceptions.some((e) => e.passed)) {
      predExcluded.push({ atom_id: c.atom.identity.atom_id, reason: "exception clause fired" });
      continue;
    }
    const failed = results.find((r) => !r.passed);
    if (failed) {
      predExcluded.push({ atom_id: c.atom.identity.atom_id, reason: `precondition ${failed.field} ${failed.operator} failed (${failed.reason ?? ""})` });
      continue;
    }
    afterPred.push(c);
  }
  steps.push({
    step: "predicate_evaluation", label: STEP_LABELS.predicate_evaluation,
    in_count: scoped.length, out_count: afterPred.length,
    notes: [`Deterministic evaluation against business_object_attributes + case_state. Atoms with requires_review scope stay in but are flagged.`],
    excluded: predExcluded.slice(0, 25),
  });

  // Step 5 — semantic rerank
  const requestText = [ctx.process, ctx.activity, ctx.business_object, ctx.role,
    ctx.business_object_attributes ? Object.entries(ctx.business_object_attributes).map(([k,v]) => `${k}=${String(v)}`).join(" ") : ""].filter(Boolean).join(" | ");
  let requestEmbedding: number[] | null = null;
  if (requestText && afterPred.some((c) => c.embedding)) {
    try {
      const { loadLlmSettings } = await import("./settings.server");
      const { embed } = await import("./llm-gateway.server");
      const s = await loadLlmSettings();
      const r = await embed(s, requestText);
      requestEmbedding = r.vector;
    } catch { /* embeddings optional — proceed without */ }
  }
  const semanticScores = new Map<string, number>();
  for (const c of afterPred) {
    semanticScores.set(c.atom.identity.atom_id, requestEmbedding && c.embedding ? cosine(requestEmbedding, c.embedding) : 0);
  }
  steps.push({
    step: "semantic_rerank", label: STEP_LABELS.semantic_rerank,
    in_count: afterPred.length, out_count: afterPred.length,
    notes: requestEmbedding
      ? [`Ranked ${afterPred.length} atom(s) by embedding cosine against the context request.`]
      : [`Skipped (no embeddings available for request or atoms). Structural ranking still applies.`],
  });

  // Step 6 — dependents & exceptions
  const currentIds = new Set(afterPred.map((c) => c.atom.identity.atom_id));
  const pulled: { c: Cand; rel: { type: string; from_atom_id: string } }[] = [];
  if (afterPred.length) {
    const { data: rels } = await admin
      .from("atom_relationships")
      .select("relationship_type, to_atom_id, from_atom, atoms:from_atom(atom_id)")
      .in("relationship_type", ["DEPENDS_ON", "EXCEPTION_TO"] as never);
    const wanted = ((rels ?? []) as Array<{ relationship_type: string; to_atom_id: string; atoms: { atom_id: string } | null }>)
      .filter((r) => r.atoms && currentIds.has(r.atoms.atom_id));
    for (const r of wanted) {
      const target = universe.find((u) => u.atom.identity.atom_id === r.to_atom_id);
      if (target && !currentIds.has(target.atom.identity.atom_id)) {
        pulled.push({ c: { ...target, matched: [], uncertain: [] }, rel: { type: r.relationship_type, from_atom_id: r.atoms!.atom_id } });
        currentIds.add(target.atom.identity.atom_id);
      }
    }
  }
  const afterRels: Cand[] = [...afterPred, ...pulled.map((p) => p.c)];
  steps.push({
    step: "dependents_and_exceptions", label: STEP_LABELS.dependents_and_exceptions,
    in_count: afterPred.length, out_count: afterRels.length,
    notes: pulled.length ? [`Pulled ${pulled.length} atom(s) via DEPENDS_ON / EXCEPTION_TO.`] : [`No dependent or exception atoms to add.`],
    detail: { pulled: pulled.map((p) => ({ atom_id: p.c.atom.identity.atom_id, via: p.rel })) },
  });

  // Step 7 — versions & precedence (versions already resolved via bitemporal filter).
  const suppressed = new Map<string, string>();
  const precedenceNotes = new Map<string, string>();
  const strategyDecisions: { pair: [string, string]; strategy: string; winner: string; loser: string; reason: string }[] = [];
  const unresolvedPairs: { pair: [string, string]; tried: string[]; reason: string }[] = [];
  {
    const { data: openConflicts } = await admin
      .from("conflicts")
      .select("atom_a, atom_b_atom_id, conflict_kind, status, atoms:atom_a(atom_id)")
      .eq("status", "open" as never);
    const { data: strategies } = await admin
      .from("precedence_strategies")
      .select("name, priority_order, enabled, created_at")
      .eq("enabled", true)
      .order("priority_order", { ascending: true })
      .order("created_at", { ascending: true });
    const orderedStrategies = (strategies ?? []) as Array<{ name: string }>;

    // Preload source effective dates for atoms present in the current set (for "later_effective_date_overrides").
    const sourceEffective = new Map<string, string | null>(); // atom_id -> ISO date or null
    {
      const sourceIds = Array.from(
        new Set(
          afterRels
            .map((c) => (c.row as { source_id?: string | null }).source_id)
            .filter((s): s is string => !!s),
        ),
      );
      if (sourceIds.length) {
        const { data: srcRows } = await admin
          .from("sources")
          .select("id, effective_date")
          .in("id", sourceIds);
        const byId = new Map(((srcRows ?? []) as Array<{ id: string; effective_date: string | null }>).map((r) => [r.id, r.effective_date]));
        for (const c of afterRels) {
          const sid = (c.row as { source_id?: string | null }).source_id ?? null;
          sourceEffective.set(c.atom.identity.atom_id, sid ? (byId.get(sid) ?? null) : null);
        }
      }
    }

    const getCand = (id: string) => afterRels.find((x) => x.atom.identity.atom_id === id);
    const specificity = (id: string): number => {
      const cand = getCand(id);
      if (!cand) return 0;
      const dims = [
        cand.atom.applicability?.process,
        cand.atom.applicability?.activities,
        cand.atom.applicability?.roles,
        cand.atom.applicability?.business_objects,
      ];
      return dims.filter((d) => d && d.status === "explicit" && (d.value?.length ?? 0) > 0).length;
    };
    const authorityOrder: Record<AuthorityLevel, number> = { regulatory: 5, board: 4, executive: 3, functional: 2, local: 1 };
    const effectiveDate = (id: string): number => {
      const cand = getCand(id);
      if (!cand) return 0;
      const srcDate = sourceEffective.get(id);
      const iso = srcDate || cand.atom.version.valid_from;
      const t = iso ? Date.parse(iso) : NaN;
      return Number.isFinite(t) ? t : 0;
    };

    type Verdict = { winner: string; loser: string; reason: string } | null;
    const apply = (strat: string, a: string, b: string): Verdict => {
      switch (strat) {
        case "more_specific_rule_overrides_general_rule": {
          const sa = specificity(a), sb = specificity(b);
          if (sa === sb) return null;
          const winner = sa > sb ? a : b;
          const loser = winner === a ? b : a;
          return { winner, loser, reason: `specificity ${Math.max(sa, sb)} > ${Math.min(sa, sb)}` };
        }
        case "higher_authority_overrides": {
          const la = authorityOrder[getCand(a)?.atom.governance?.authority_level ?? "local"];
          const lb = authorityOrder[getCand(b)?.atom.governance?.authority_level ?? "local"];
          if (la === lb) return null;
          const winner = la > lb ? a : b;
          const loser = winner === a ? b : a;
          return { winner, loser, reason: `authority ${getCand(winner)?.atom.governance?.authority_level} > ${getCand(loser)?.atom.governance?.authority_level}` };
        }
        case "later_effective_date_overrides": {
          const da = effectiveDate(a), db = effectiveDate(b);
          if (!da || !db || da === db) return null;
          const winner = da > db ? a : b;
          const loser = winner === a ? b : a;
          return { winner, loser, reason: `effective date ${new Date(Math.max(da, db)).toISOString().slice(0, 10)} > ${new Date(Math.min(da, db)).toISOString().slice(0, 10)}` };
        }
        default:
          return null; // unknown/custom strategy — cannot auto-decide
      }
    };

    const idSet = new Set(afterRels.map((c) => c.atom.identity.atom_id));
    for (const c of (openConflicts ?? []) as Array<{ conflict_kind: string; atoms: { atom_id: string } | null; atom_b_atom_id: string }>) {
      const a = c.atoms?.atom_id;
      const b = c.atom_b_atom_id;
      if (!a || !b || !idSet.has(a) || !idSet.has(b)) continue;
      if (suppressed.has(a) || suppressed.has(b)) continue;
      // Iterate enabled strategies in configured priority order; first-decides.
      const tried: string[] = [];
      let decided: { strategy: string; winner: string; loser: string; reason: string } | null = null;
      for (const s of orderedStrategies) {
        tried.push(s.name);
        const v = apply(s.name, a, b);
        if (v) { decided = { strategy: s.name, ...v }; break; }
      }
      if (decided) {
        suppressed.set(
          decided.loser,
          `Suppressed by strategy "${decided.strategy}" — ${decided.reason} (winner: ${decided.winner})`,
        );
        strategyDecisions.push({ pair: [a, b], strategy: decided.strategy, winner: decided.winner, loser: decided.loser, reason: decided.reason });
      } else {
        const note = `conflict unresolved — human decision required (tried: ${tried.length ? tried.join(", ") : "none enabled"})`;
        precedenceNotes.set(a, note);
        precedenceNotes.set(b, note);
        unresolvedPairs.push({ pair: [a, b], tried, reason: note });
      }
    }
  }
  const afterVersion = afterRels.filter((c) => !suppressed.has(c.atom.identity.atom_id));
  steps.push({
    step: "version_and_precedence", label: STEP_LABELS.version_and_precedence,
    in_count: afterRels.length, out_count: afterVersion.length,
    notes: [
      `Bitemporal filter applied (valid at ${asOf.toISOString()}); newest version per atom_id kept.`,
      suppressed.size ? `${suppressed.size} atom(s) suppressed via enabled precedence strategies.` : `No conflicts to resolve among the current set.`,
      unresolvedPairs.length ? `${unresolvedPairs.length} conflict pair(s) unresolved by any enabled strategy — both atoms kept and flagged for human decision.` : `All applicable conflicts decided by an enabled strategy.`,
    ],
    excluded: Array.from(suppressed.entries()).map(([atom_id, reason]) => ({ atom_id, reason })),
    detail: {
      strategy_decisions: strategyDecisions as unknown as JsonValue,
      unresolved_pairs: unresolvedPairs as unknown as JsonValue,
    },
  });

  // Step 8 — rerank by necessity + authority + semantic
  const finalItems: RetrievedAtom[] = afterVersion.map((c) => {
    const semantic = semanticScores.get(c.atom.identity.atom_id) ?? 0;
    const modality = c.atom.action?.modality ?? "MAY";
    const authority = c.atom.governance?.authority_level ?? "local";
    const score = modalityWeight(modality) * 100 + authorityWeight(authority) * 10 + semantic;
    const pulledInfo = pulled.find((p) => p.c.atom.identity.atom_id === c.atom.identity.atom_id);
    return {
      atom_db_id: (c.row as { id: string }).id,
      atom_id: c.atom.identity.atom_id,
      name: c.atom.identity.name,
      version: c.atom.version.version,
      knowledge_type: c.atom.knowledge_type,
      modality,
      authority_level: authority,
      scope_uncertain: c.uncertain.length > 0,
      uncertain_dimensions: c.uncertain,
      score: +score.toFixed(4),
      reasons: {
        matched_dimensions: c.matched,
        predicate_results: predResults.get(c.atom.identity.atom_id) ?? [],
        semantic_score: +semantic.toFixed(4),
        relationship_pull: pulledInfo?.rel,
        precedence_note: precedenceNotes.get(c.atom.identity.atom_id),
      },
      atom: c.atom,
    };
  }).sort((a, b) => b.score - a.score);

  // Add mandatory globals at the top (they always apply and were not scope-filtered).
  const mandatoryOut: RetrievedAtom[] = mandatory.map(({ row, atom }) => ({
    atom_db_id: (row as { id: string }).id,
    atom_id: atom.identity.atom_id,
    name: atom.identity.name,
    version: atom.version.version,
    knowledge_type: atom.knowledge_type,
    modality: atom.action?.modality ?? "MAY",
    authority_level: atom.governance?.authority_level ?? "local",
    scope_uncertain: false,
    uncertain_dimensions: [],
    score: modalityWeight(atom.action?.modality ?? "MAY") * 100 + authorityWeight(atom.governance?.authority_level ?? "local") * 10 + 1,
    reasons: { matched_dimensions: ["mandatory_global"], predicate_results: [], semantic_score: 0 },
    atom,
  }));

  const finalOrdered = [...mandatoryOut, ...finalItems];
  steps.push({
    step: "necessity_authority_rerank", label: STEP_LABELS.necessity_authority_rerank,
    in_count: afterVersion.length + mandatory.length, out_count: finalOrdered.length,
    notes: [`Ordered by modality (MUST/MUST_NOT first), then authority_level, then semantic score.`],
  });

  const { data: mem } = await admin.from("memory_state").select("generation").eq("id", true).maybeSingle();

  return {
    resolved_context: resolved,
    memory_generation: (mem as { generation?: number } | null)?.generation ?? null,
    steps,
    atoms: finalOrdered,
  };
}