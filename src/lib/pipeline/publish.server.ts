/**
 * Stage 14 — Versioned atomic publication.
 *
 * For each approved (or edited_approved) change_set_item, execute the paper's
 * 7-step publication for the affected atom lineage:
 *   1. Close the superseded version's validity (status=superseded, valid_to=now)
 *   2. Insert/activate the new version (status=active, valid_from=now, version=prev+1)
 *   3. Rebuild retrieval representations (copy embedding, refresh filter columns)
 *   4. Apply relationship changes to atom_relationships (from conflict findings)
 *   5. Bump memory_state.generation so cached retrieval is invalidated
 *   6. Record an audit_events publication event
 *   7. Create notification rows for affected owners
 *
 * HARD GATE (groundedness): if any action or scope field has derivation
 * "unknown" or a scope dimension still has requires_review=true, publication
 * is REFUSED with a clear error listing the blocking fields.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ProcessAtom, RelationshipType } from "@/types/atom";
import type { ConflictFinding } from "./analyze-conflicts.server";
import { verdictToRelationship } from "./analyze-conflicts.server";

export interface PublicationBlocker {
  item_id: string;
  atom_id: string;
  blocking_fields: string[];
}

function findBlockingFields(atom: ProcessAtom): string[] {
  const blockers: string[] = [];

  // Action derivation must not be unknown (groundedness hard gate)
  const actionFields = ["modality", "actor", "operation", "object", "target"] as const;
  const der = (atom.action?.derivation ?? {}) as Record<string, string>;
  for (const f of actionFields) if (der[f] === "unknown") blockers.push(`action.${f}`);

  // Scope dimensions with requires_review=true block
  const app = atom.applicability ?? ({} as ProcessAtom["applicability"]);
  const dims: [string, { requires_review?: boolean; status?: string } | undefined][] = [
    ["process", app.process],
    ["activities", app.activities],
    ["roles", app.roles],
    ["business_objects", app.business_objects],
  ];
  for (const [k, v] of dims) {
    if (v?.requires_review) blockers.push(`applicability.${k}(requires_review)`);
  }

  return blockers;
}

// Derive denormalized filter columns from applicability
function denormFilters(atom: ProcessAtom) {
  return {
    processes: (atom.applicability?.process?.value ?? []) as string[],
    activities: (atom.applicability?.activities?.value ?? []) as string[],
    roles: (atom.applicability?.roles?.value ?? []) as string[],
    business_objects: (atom.applicability?.business_objects?.value ?? []) as string[],
  };
}

export interface ApplyOutcome {
  applied: number;
  rejected: number;
  refused: PublicationBlocker[];
  notifications_sent: number;
  relationships_written: number;
}

export async function applyChangeSet(
  admin: SupabaseClient<Database>,
  changeSetId: string,
  actorId: string,
): Promise<ApplyOutcome> {
  const { data: cs } = await admin
    .from("change_sets")
    .select("id, source_id, status")
    .eq("id", changeSetId)
    .single();
  if (!cs) throw new Error("Change set not found");

  const { data: items } = await admin
    .from("change_set_items")
    .select("id, operation, review_status, existing_atom, atom_payload, atom_embedding, conflict_findings")
    .eq("change_set_id", changeSetId);

  const outcome: ApplyOutcome = { applied: 0, rejected: 0, refused: [], notifications_sent: 0, relationships_written: 0 };
  if (!items?.length) return outcome;

  const refused: PublicationBlocker[] = [];
  const approvable = items.filter((it) => it.review_status === "approved" || it.review_status === "edited_approved");

  // Pre-flight groundedness gate — refuse the whole apply if ANY approved item is ungrounded.
  for (const it of approvable) {
    if (it.operation === "no_change" || it.operation === "conflict_review") continue;
    const atom = it.atom_payload as unknown as ProcessAtom;
    const blockers = findBlockingFields(atom);
    if (blockers.length) refused.push({ item_id: it.id, atom_id: atom.identity.atom_id, blocking_fields: blockers });
  }
  if (refused.length) {
    outcome.refused = refused;
    throw new PublicationBlockedError(refused);
  }

  const notifyRecipients = new Set<string>([actorId]);

  for (const it of items) {
    if (it.review_status === "rejected") { outcome.rejected++; continue; }
    if (it.review_status !== "approved" && it.review_status !== "edited_approved") continue;
    if (it.operation === "no_change" || it.operation === "conflict_review") continue;

    const atom = it.atom_payload as unknown as ProcessAtom;
    const filters = denormFilters(atom);
    const nowIso = new Date().toISOString();

    // Step 1 — close superseded version, if modifying
    let previousVersion = 0;
    if (it.operation === "modify" && it.existing_atom) {
      const { data: prev } = await admin
        .from("atoms")
        .select("version, atom_id, governance")
        .eq("id", it.existing_atom)
        .single();
      previousVersion = prev?.version ?? 0;
      await admin
        .from("atoms")
        .update({ status: "superseded", valid_to: nowIso } as never)
        .eq("id", it.existing_atom);
      const gov = (prev?.governance as { owner?: string } | null) ?? null;
      if (gov?.owner) notifyRecipients.add(gov.owner);
    }

    // Step 2/3 — insert new active row
    const insertRow: Record<string, unknown> = {
      atom_id: atom.identity.atom_id,
      name: atom.identity.name,
      version: previousVersion + 1,
      status: "active",
      knowledge_type: atom.knowledge_type,
      applicability: atom.applicability as never,
      action: atom.action as never,
      purpose: atom.purpose as never,
      domain_tags: atom.domain_tags as never,
      provenance: atom.provenance as never,
      governance: atom.governance as never,
      quality: atom.quality as never,
      valid_from: nowIso,
      transaction_time: nowIso,
      source_id: cs.source_id,
      created_by: actorId,
      processes: filters.processes,
      activities: filters.activities,
      roles: filters.roles,
      business_objects: filters.business_objects,
    };
    if (Array.isArray(it.atom_embedding)) insertRow.embedding = it.atom_embedding as never;

    const { data: inserted, error: insErr } = await admin
      .from("atoms")
      .insert(insertRow as never)
      .select("id")
      .single();
    if (insErr || !inserted) throw insErr ?? new Error("insert atom failed");

    // Step 4 — apply relationship changes
    const relInserts: {
      from_atom: string;
      to_atom_id: string;
      relationship_type: RelationshipType;
      rationale: string | null;
    }[] = [];
    if (it.operation === "modify" && it.existing_atom) {
      const { data: prev } = await admin.from("atoms").select("atom_id").eq("id", it.existing_atom).single();
      if (prev?.atom_id) {
        relInserts.push({
          from_atom: inserted.id,
          to_atom_id: prev.atom_id,
          relationship_type: "SUPERSEDES",
          rationale: it.operation === "modify" ? "Automatic supersession on publication." : null,
        });
      }
    }
    for (const f of (it.conflict_findings as unknown as ConflictFinding[]) ?? []) {
      const rel = verdictToRelationship(f.verdict);
      if (!rel || rel === "CONFLICTS_WITH") continue; // conflicts require explicit resolution first
      relInserts.push({
        from_atom: inserted.id,
        to_atom_id: f.neighbor_atom_id,
        relationship_type: rel,
        rationale: f.detail.reason,
      });
    }
    if (relInserts.length) {
      await admin.from("atom_relationships").insert(relInserts as never);
      outcome.relationships_written += relInserts.length;
    }

    // Step 7 — notifications
    if (atom.governance?.owner) notifyRecipients.add(atom.governance.owner);
    for (const r of atom.governance?.required_approvers ?? []) notifyRecipients.add(r);
    const notifRows = Array.from(notifyRecipients).map((rid) => ({
      recipient: rid,
      atom_id: atom.identity.atom_id,
      change_set_item_id: it.id,
      event_type: it.operation === "modify" ? "atom.superseded" : "atom.published",
      summary: `${atom.identity.name} — v${previousVersion + 1} (${it.operation})`,
    }));
    if (notifRows.length) {
      await admin.from("notifications").insert(notifRows as never);
      outcome.notifications_sent += notifRows.length;
    }
    notifyRecipients.clear();
    notifyRecipients.add(actorId);

    // Mark item applied via audit trail — we keep review_status as-is; the item
    // reads as "applied" because change_set status flips below.
    outcome.applied++;
  }

  // Step 5 — bump memory_generation (runtime cache invalidation)
  await admin.from("memory_state").update({
    generation: ((await admin.from("memory_state").select("generation").eq("id", true).single()).data?.generation ?? 0) + 1,
    updated_at: new Date().toISOString(),
  } as never).eq("id", true);

  // Step 6 — audit event for the change set as a whole
  await admin.from("audit_events").insert({
    event_type: "change_set.published",
    entity_type: "change_set",
    entity_id: cs.id,
    actor: actorId,
    payload: outcome as never,
  } as never);

  // Close change_set
  const rejectedCount = items.filter((it) => it.review_status === "rejected").length;
  const pendingCount = items.filter((it) => it.review_status === "pending").length;
  const finalStatus = pendingCount > 0 || rejectedCount > 0 ? "partially_applied" : "applied";
  await admin.from("change_sets").update({ status: finalStatus } as never).eq("id", cs.id);

  return outcome;
}

export class PublicationBlockedError extends Error {
  constructor(public readonly blockers: PublicationBlocker[]) {
    super(
      `Publication refused — groundedness gate. Blocking fields: ` +
        blockers.map((b) => `${b.atom_id}[${b.blocking_fields.join(", ")}]`).join(" · "),
    );
    this.name = "PublicationBlockedError";
  }
}
