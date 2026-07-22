/**
 * Stage 11 — Duplicate / overlap / conflict analysis (the paper's formal calculus).
 *
 * For each (draft, neighbor) pair from Stage 10, deterministically compute:
 *   - Overlap(A, B): scopes can co-apply — intersection non-empty on every
 *     dimension where BOTH atoms constrain the value. A `not_stated` dimension
 *     is treated as UNKNOWN (neither guarantees nor excludes overlap).
 *   - Specializes(A, B): A's constrained dimensions are subsets of B's on
 *     every dimension A restricts.
 *   - Duplicate(A, B): equivalent scope AND equivalent action.
 *   - Conflict(A, B): Overlap AND incompatible actions.
 *
 * When deterministic analysis is inconclusive, fall back to an LLM comparator
 * call. Every finding records "deterministic" vs "comparator" source.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ProcessAtom, ScopedValue, AtomAction, RelationshipType } from "@/types/atom";
import { chat, parseJsonLoose } from "./llm-gateway.server";
import { loadLlmSettings, loadActivePrompt } from "./settings.server";

type ConflictKind = Database["public"]["Enums"]["conflict_kind"];

export type Verdict =
  | "duplicate"
  | "specializes_a_to_b"
  | "specializes_b_to_a"
  | "overlap_compatible"
  | "overlap_conflict"
  | "inconclusive"
  | "unrelated";

export interface ConflictFinding {
  neighbor_db_id: string;
  neighbor_atom_id: string;
  neighbor_version: number;
  verdict: Verdict;
  source: "deterministic" | "comparator";
  conflict_kind: ConflictKind | null;
  detail: {
    dimensions: Record<string, DimensionCompare>;
    action_compare: ActionCompare;
    reason: string;
  };
}

interface DimensionCompare {
  a: string[] | null;
  b: string[] | null;
  a_status: string;
  b_status: string;
  relation: "equal" | "a_subset_b" | "b_subset_a" | "disjoint" | "overlap" | "unknown";
}

interface ActionCompare {
  same_operation_object: boolean;
  same_modality: boolean;
  contradictory_modality: boolean;
  different_target: boolean;
  parameter_conflicts: string[];
  equivalent: boolean;
}

function isConstrained(sv: ScopedValue | undefined): boolean {
  return !!sv && sv.status !== "not_stated" && Array.isArray(sv.value) && sv.value.length > 0;
}
function values(sv: ScopedValue | undefined): string[] {
  return isConstrained(sv) ? (sv!.value as string[]).map((v) => v.toLowerCase()) : [];
}
function svstatus(sv: ScopedValue | undefined): string {
  return sv?.status ?? "not_stated";
}

function compareDim(a: ScopedValue | undefined, b: ScopedValue | undefined): DimensionCompare {
  const av = values(a);
  const bv = values(b);
  const aC = isConstrained(a);
  const bC = isConstrained(b);
  let relation: DimensionCompare["relation"] = "unknown";
  if (!aC || !bC) relation = "unknown";
  else {
    const A = new Set(av), B = new Set(bv);
    const inter = av.filter((x) => B.has(x));
    if (inter.length === 0) relation = "disjoint";
    else if (A.size === B.size && inter.length === A.size) relation = "equal";
    else if (inter.length === A.size) relation = "a_subset_b";
    else if (inter.length === B.size) relation = "b_subset_a";
    else relation = "overlap";
  }
  return {
    a: aC ? av : null,
    b: bC ? bv : null,
    a_status: svstatus(a),
    b_status: svstatus(b),
    relation,
  };
}

const DIMENSIONS: { key: string; get: (a: ProcessAtom) => ScopedValue | undefined }[] = [
  { key: "process", get: (a) => a.applicability?.process },
  { key: "activities", get: (a) => a.applicability?.activities },
  { key: "roles", get: (a) => a.applicability?.roles },
  { key: "business_objects", get: (a) => a.applicability?.business_objects },
  { key: "company_codes", get: (a) => a.applicability?.organizational_scope?.company_codes },
  { key: "subsidiaries", get: (a) => a.applicability?.organizational_scope?.subsidiaries },
  { key: "plants", get: (a) => a.applicability?.organizational_scope?.plants },
];

function normStr(s: string | undefined | null): string {
  return (s ?? "").trim().toLowerCase();
}

function compareActions(a: AtomAction | undefined, b: AtomAction | undefined): ActionCompare {
  const same_operation_object =
    !!a && !!b && normStr(a.operation) === normStr(b.operation) && normStr(a.object) === normStr(b.object);
  const same_modality = !!a && !!b && a.modality === b.modality;
  const contradictory_modality = !!a && !!b && (
    (a.modality === "MUST" && b.modality === "MUST_NOT") ||
    (a.modality === "MUST_NOT" && b.modality === "MUST") ||
    (a.modality === "MAY" && b.modality === "MUST_NOT") ||
    (a.modality === "MUST_NOT" && b.modality === "MAY")
  );
  const different_target = !!a?.target && !!b?.target && normStr(a.target) !== normStr(b.target);

  const parameter_conflicts: string[] = [];
  const ap = (a?.parameters ?? {}) as Record<string, unknown>;
  const bp = (b?.parameters ?? {}) as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ap), ...Object.keys(bp)])) {
    if (k in ap && k in bp && JSON.stringify(ap[k]) !== JSON.stringify(bp[k])) {
      parameter_conflicts.push(`${k}: ${JSON.stringify(ap[k])} vs ${JSON.stringify(bp[k])}`);
    }
  }

  const equivalent =
    same_operation_object &&
    same_modality &&
    normStr(a?.actor) === normStr(b?.actor) &&
    parameter_conflicts.length === 0 &&
    (!a?.target || !b?.target || !different_target);

  return { same_operation_object, same_modality, contradictory_modality, different_target, parameter_conflicts, equivalent };
}

function decideDeterministic(
  dims: Record<string, DimensionCompare>,
  act: ActionCompare,
): { verdict: Verdict | "inconclusive"; conflict_kind: ConflictKind | null; reason: string } {
  const rels = Object.values(dims).map((d) => d.relation);
  const anyDisjoint = rels.some((r) => r === "disjoint");
  const anyUnknown = rels.some((r) => r === "unknown");
  const allEqual = rels.every((r) => r === "equal" || r === "unknown");
  const aAllSubset = rels.every((r) => r === "equal" || r === "a_subset_b" || r === "unknown");
  const bAllSubset = rels.every((r) => r === "equal" || r === "b_subset_a" || r === "unknown");

  if (anyDisjoint) return { verdict: "unrelated", conflict_kind: null, reason: "Disjoint on at least one dimension." };

  if (allEqual && act.equivalent && !anyUnknown) {
    return { verdict: "duplicate", conflict_kind: null, reason: "Equivalent scope and equivalent action." };
  }

  if (act.same_operation_object) {
    if (act.contradictory_modality) {
      return { verdict: "overlap_conflict", conflict_kind: "incompatible_action", reason: "Contradictory modality on same operation/object." };
    }
    if (act.parameter_conflicts.length > 0 && act.same_modality) {
      return { verdict: "overlap_conflict", conflict_kind: "incompatible_action", reason: "Same obligation, different parameters: " + act.parameter_conflicts.join("; ") };
    }
    if (act.different_target && act.same_modality) {
      return { verdict: "overlap_conflict", conflict_kind: "incompatible_action", reason: "Same obligation routed to exclusive targets." };
    }
  }

  if (aAllSubset && !bAllSubset && !anyUnknown) {
    return { verdict: "specializes_a_to_b", conflict_kind: null, reason: "A's scope is a subset of B's." };
  }
  if (bAllSubset && !aAllSubset && !anyUnknown) {
    return { verdict: "specializes_b_to_a", conflict_kind: null, reason: "B's scope is a subset of A's." };
  }

  if (rels.some((r) => r === "overlap" || r === "a_subset_b" || r === "b_subset_a" || r === "equal")) {
    if (!act.same_operation_object) {
      return { verdict: "overlap_compatible", conflict_kind: null, reason: "Scopes overlap; distinct operations coexist." };
    }
    if (act.same_operation_object && !act.contradictory_modality && act.parameter_conflicts.length === 0) {
      return { verdict: "overlap_compatible", conflict_kind: null, reason: "Scopes overlap; actions cumulative and compatible." };
    }
  }

  return { verdict: "inconclusive", conflict_kind: null, reason: "Deterministic analysis inconclusive." };
}

interface NeighborShort {
  db_id: string;
  atom_id: string;
  name: string;
  version: number;
  knowledge_type: string;
  action: AtomAction | undefined;
  applicability: ProcessAtom["applicability"] | undefined;
}

async function comparatorLLM(atom: ProcessAtom, n: NeighborShort) {
  try {
    const settings = await loadLlmSettings();
    const prompt = await loadActivePrompt("comparator");
    const payload = {
      A: { atom_id: atom.identity.atom_id, knowledge_type: atom.knowledge_type, action: atom.action, applicability: atom.applicability },
      B: { atom_id: n.atom_id, knowledge_type: n.knowledge_type, action: n.action, applicability: n.applicability },
    };
    const res = await chat({
      settings,
      promptKey: "comparator",
      promptVersion: prompt.version,
      json: true,
      messages: [
        { role: "system", content: prompt.template },
        { role: "user", content: JSON.stringify(payload, null, 2) },
      ],
    });
    const parsed = parseJsonLoose<{ verdict?: string; reason?: string; conflict_kind?: string | null }>(res.content);
    const allowed: Verdict[] = ["duplicate", "specializes_a_to_b", "specializes_b_to_a", "overlap_compatible", "overlap_conflict", "unrelated"];
    if (!parsed?.verdict || !allowed.includes(parsed.verdict as Verdict)) return null;
    const ck = parsed.conflict_kind === "incompatible_action" ? "incompatible_action" as ConflictKind : null;
    return { verdict: parsed.verdict as Verdict, conflict_kind: ck, reason: parsed.reason ?? "Comparator decision" };
  } catch (e) {
    console.warn("comparator LLM failed:", (e as Error).message);
    return null;
  }
}

export interface ConflictAnalysisOutcome {
  pairs_examined: number;
  duplicates: number;
  specializations: number;
  overlaps: number;
  conflicts: number;
  comparator_calls: number;
}

export function verdictToRelationship(v: Verdict): RelationshipType | null {
  switch (v) {
    case "duplicate": return "DUPLICATES";
    case "specializes_a_to_b": return "SPECIALIZES";
    case "specializes_b_to_a": return "GENERALIZES";
    case "overlap_compatible": return "OVERLAPS";
    case "overlap_conflict": return "CONFLICTS_WITH";
    default: return null;
  }
}

export async function analyzeConflictsForChangeSet(
  admin: SupabaseClient<Database>,
  changeSetId: string,
  opts: { batchSize?: number } = {},
): Promise<ConflictAnalysisOutcome & { remaining: number }> {
  const batchSize = opts.batchSize ?? 5;
  const { data: items } = await admin
    .from("change_set_items")
    .select("id, atom_payload, neighbors")
    .eq("change_set_id", changeSetId)
    .is("curated_at", null)
    .order("id", { ascending: true })
    .limit(batchSize);
  if (!items?.length) {
    return { pairs_examined: 0, duplicates: 0, specializations: 0, overlaps: 0, conflicts: 0, comparator_calls: 0, remaining: 0 };
  }

  const neighborIds = new Set<string>();
  for (const it of items) {
    for (const n of (it.neighbors as unknown as { atom_db_id: string }[]) ?? []) {
      if (n?.atom_db_id) neighborIds.add(n.atom_db_id);
    }
  }
  const neighborsById = new Map<string, NeighborShort>();
  if (neighborIds.size) {
    const { data: rows } = await admin
      .from("atoms")
      .select("id, atom_id, name, version, knowledge_type, action, applicability")
      .in("id", Array.from(neighborIds));
    for (const r of rows ?? []) {
      neighborsById.set(r.id, {
        db_id: r.id,
        atom_id: r.atom_id,
        name: r.name,
        version: r.version,
        knowledge_type: r.knowledge_type,
        action: r.action as unknown as AtomAction,
        applicability: r.applicability as unknown as ProcessAtom["applicability"],
      });
    }
  }

  const out: ConflictAnalysisOutcome = { pairs_examined: 0, duplicates: 0, specializations: 0, overlaps: 0, conflicts: 0, comparator_calls: 0 };

  for (const item of items) {
    const atom = item.atom_payload as unknown as ProcessAtom;
    if (!atom?.identity) continue;
    const findings: ConflictFinding[] = [];
    // Rows to insert into public.conflicts once per (item, neighbor) that
    // becomes overlap_conflict OR inconclusive. Existing atoms are `atom_a`
    // (a real uuid); the draft is referenced by its atom_id string in
    // `atom_b_atom_id` because it may not yet have a row in `atoms`.
    const conflictRows: {
      atom_a: string;
      atom_b_atom_id: string;
      conflict_kind: ConflictKind;
      status: Database["public"]["Enums"]["conflict_status"];
      detail: unknown;
    }[] = [];

    for (const nref of (item.neighbors as unknown as { atom_db_id: string }[]) ?? []) {
      const n = neighborsById.get(nref.atom_db_id);
      if (!n) continue;
      out.pairs_examined++;

      const dims: Record<string, DimensionCompare> = {};
      const nAtomLike = { applicability: n.applicability } as ProcessAtom;
      for (const d of DIMENSIONS) dims[d.key] = compareDim(d.get(atom), d.get(nAtomLike));
      const act = compareActions(atom.action, n.action);
      const det = decideDeterministic(dims, act);

      let verdict: Verdict;
      let conflict_kind: ConflictKind | null = null;
      let source: "deterministic" | "comparator" = "deterministic";
      let reason = det.reason;

      if (det.verdict === "inconclusive") {
        const llm = await comparatorLLM(atom, n);
        out.comparator_calls++;
        if (!llm) {
          // Ambiguity principle: unknown ≠ compatible. When deterministic
          // analysis was inconclusive AND the LLM comparator is unavailable
          // (network error, disabled, invalid response), we do NOT silently
          // assume compatibility. We surface it as an explicit "inconclusive"
          // verdict so downstream stages route it to human review.
          verdict = "inconclusive";
          conflict_kind = "overlap";
          reason = "Deterministic analysis inconclusive and comparator unavailable — requires human judgment.";
        } else {
          verdict = llm.verdict;
          conflict_kind = llm.conflict_kind;
          reason = llm.reason;
          source = "comparator";
        }
      } else {
        verdict = det.verdict as Verdict;
        conflict_kind = det.conflict_kind;
      }

      findings.push({
        neighbor_db_id: n.db_id,
        neighbor_atom_id: n.atom_id,
        neighbor_version: n.version,
        verdict,
        source,
        conflict_kind,
        detail: { dimensions: dims, action_compare: act, reason },
      });

      if (verdict === "duplicate") out.duplicates++;
      else if (verdict === "specializes_a_to_b" || verdict === "specializes_b_to_a") out.specializations++;
      else if (verdict === "overlap_compatible") out.overlaps++;
      else if (verdict === "overlap_conflict") out.conflicts++;
      // "inconclusive" is counted under conflicts for review workload: it
      // requires the same "human must look at the pair" attention.
      else if (verdict === "inconclusive") out.conflicts++;

      if (verdict === "overlap_conflict" || verdict === "inconclusive") {
        conflictRows.push({
          atom_a: n.db_id,
          atom_b_atom_id: atom.identity.atom_id,
          conflict_kind: verdict === "inconclusive" ? "overlap" : (conflict_kind ?? "incompatible_action"),
          status: "open",
          detail: {
            change_set_item_id: item.id,
            draft_atom_id: atom.identity.atom_id,
            neighbor_atom_id: n.atom_id,
            neighbor_version: n.version,
            verdict,
            source,
            reason,
            dimensions: dims,
            action_compare: act,
          },
        });
      }
    }

    await admin
      .from("change_set_items")
      .update({ conflict_findings: findings as never })
      .eq("id", item.id);

    if (conflictRows.length) {
      await admin.from("conflicts").insert(conflictRows as never);
    }

    await admin
      .from("change_set_items")
      .update({ curated_at: new Date().toISOString() } as never)
      .eq("id", item.id);
  }

  const { count } = await admin
    .from("change_set_items")
    .select("id", { count: "exact", head: true })
    .eq("change_set_id", changeSetId)
    .is("curated_at", null);

  return { ...out, remaining: count ?? 0 };
}
