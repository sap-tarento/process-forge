/**
 * Stage 12 — Contextualized change set generation.
 *
 * Assigns one of the paper's operations to each change_set_item based on
 * conflict-analysis findings from Stage 11 and any prior lineage.
 *
 *   +  add                — no duplicate/conflict against existing memory
 *   ~  modify             — duplicate of existing (with improvements) OR
 *                           same atom_id lineage superseded by a newer source
 *   =  no_change          — exact duplicate, nothing new
 *   −  remove             — (future) rule no longer present after re-ingest
 *   !  conflict_review    — any detected overlap_conflict
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ProcessAtom } from "@/types/atom";
import type { ConflictFinding } from "./analyze-conflicts.server";

type ChangeOp = Database["public"]["Enums"]["change_op"];

export interface ChangeSetGenerationOutcome {
  add: number;
  modify: number;
  no_change: number;
  remove: number;
  conflict_review: number;
}

// Heuristic: an atom "improves" its duplicate when it has more evidence
// or more constrained scope than the existing neighbor.
function isImprovement(atom: ProcessAtom, existing: ExistingAtomRow): boolean {
  const evCount = atom.provenance?.quoted_evidence?.length ?? 0;
  const existingEv = ((existing.provenance as { quoted_evidence?: unknown[] } | null)?.quoted_evidence ?? []).length;
  if (evCount > existingEv) return true;
  const dims = ["process", "activities", "roles", "business_objects"] as const;
  for (const d of dims) {
    const av = atom.applicability?.[d]?.value ?? [];
    const bv = ((existing.applicability as Record<string, { value?: string[] }> | null)?.[d]?.value ?? []);
    if (Array.isArray(av) && Array.isArray(bv) && av.length > bv.length) return true;
  }
  return false;
}

interface ExistingAtomRow {
  id: string;
  atom_id: string;
  version: number;
  status: string;
  applicability: unknown;
  provenance: unknown;
}

export async function generateChangeSet(
  admin: SupabaseClient<Database>,
  changeSetId: string,
): Promise<ChangeSetGenerationOutcome> {
  const { data: items } = await admin
    .from("change_set_items")
    .select("id, atom_payload, conflict_findings")
    .eq("change_set_id", changeSetId);
  if (!items?.length) return { add: 0, modify: 0, no_change: 0, remove: 0, conflict_review: 0 };

  // Lineage lookup: find existing atoms with the same atom_id
  const atomIds = items
    .map((it) => (it.atom_payload as unknown as ProcessAtom | null)?.identity?.atom_id)
    .filter((x): x is string => !!x);
  const lineageByAtomId = new Map<string, ExistingAtomRow>();
  if (atomIds.length) {
    const { data: existingRows } = await admin
      .from("atoms")
      .select("id, atom_id, version, status, applicability, provenance")
      .in("atom_id", atomIds)
      .in("status", ["active", "approved"]);
    for (const r of existingRows ?? []) {
      const prev = lineageByAtomId.get(r.atom_id);
      if (!prev || r.version > prev.version) lineageByAtomId.set(r.atom_id, r as ExistingAtomRow);
    }
  }

  // Also build a lookup of duplicate targets by neighbor db id
  const neighborDbIds = new Set<string>();
  for (const it of items) {
    for (const f of (it.conflict_findings as unknown as ConflictFinding[]) ?? []) {
      if (f?.neighbor_db_id) neighborDbIds.add(f.neighbor_db_id);
    }
  }
  const neighborsById = new Map<string, ExistingAtomRow>();
  if (neighborDbIds.size) {
    const { data } = await admin
      .from("atoms")
      .select("id, atom_id, version, status, applicability, provenance")
      .in("id", Array.from(neighborDbIds));
    for (const r of data ?? []) neighborsById.set(r.id, r as ExistingAtomRow);
  }

  const out: ChangeSetGenerationOutcome = { add: 0, modify: 0, no_change: 0, remove: 0, conflict_review: 0 };

  for (const item of items) {
    const atom = item.atom_payload as unknown as ProcessAtom;
    if (!atom?.identity) continue;
    const findings = (item.conflict_findings as unknown as ConflictFinding[]) ?? [];

    let operation: ChangeOp = "add";
    let existing_atom: string | null = null;
    let rationale = "No overlap detected against current memory.";

    const conflict = findings.find((f) => f.verdict === "overlap_conflict");
    const duplicate = findings.find((f) => f.verdict === "duplicate");
    const lineage = lineageByAtomId.get(atom.identity.atom_id);

    if (conflict) {
      operation = "conflict_review";
      existing_atom = conflict.neighbor_db_id;
      rationale = `Conflict with ${conflict.neighbor_atom_id}: ${conflict.detail.reason}`;
      out.conflict_review++;
    } else if (duplicate) {
      const existing = neighborsById.get(duplicate.neighbor_db_id);
      existing_atom = duplicate.neighbor_db_id;
      if (existing && isImprovement(atom, existing)) {
        operation = "modify";
        rationale = `Improves duplicate ${duplicate.neighbor_atom_id} (more evidence or tighter scope).`;
        out.modify++;
      } else {
        operation = "no_change";
        rationale = `Exact duplicate of ${duplicate.neighbor_atom_id} — nothing new to record.`;
        out.no_change++;
      }
    } else if (lineage) {
      operation = "modify";
      existing_atom = lineage.id;
      rationale = `Supersedes existing lineage ${lineage.atom_id} v${lineage.version} from a newer source.`;
      out.modify++;
    } else {
      out.add++;
    }

    await admin
      .from("change_set_items")
      .update({ operation, existing_atom, rationale } as never)
      .eq("id", item.id);
  }

  // Move change_set into pending_review
  await admin
    .from("change_sets")
    .update({ status: "pending_review" } as never)
    .eq("id", changeSetId);

  return out;
}
