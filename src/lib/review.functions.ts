/**
 * Server functions powering the human-review workspace (Stage 13) and
 * the "Apply approved items" action (Stage 14).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ProcessAtom } from "@/types/atom";

async function assertRole(context: { supabase: any; userId: string }, roles: string[]) {
  const { data } = await context.supabase.rpc("has_any_role", { _roles: roles, _user_id: context.userId });
  if (!data) throw new Error(`Forbidden: requires one of ${roles.join(", ")}`);
}

const ItemId = z.object({ itemId: z.string().uuid() });

export const approveItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => ItemId.parse(v))
  .handler(async ({ data, context }) => {
    await assertRole(context, ["admin", "policy_owner", "curator"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: item } = await supabaseAdmin.from("change_set_items").select("id, atom_payload").eq("id", data.itemId).single();
    if (!item) throw new Error("Item not found");
    await supabaseAdmin.from("change_set_items")
      .update({ review_status: "approved", reviewed_by: context.userId, reviewed_at: new Date().toISOString() } as never)
      .eq("id", data.itemId);
    await supabaseAdmin.from("audit_events").insert({
      event_type: "review.approved", entity_type: "change_set_item", entity_id: data.itemId, actor: context.userId,
      payload: { atom_id: (item.atom_payload as unknown as ProcessAtom)?.identity?.atom_id } as never,
    } as never);
    return { ok: true };
  });

const EditInput = z.object({ itemId: z.string().uuid(), atom_payload: z.unknown() });
export const editThenApprove = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => EditInput.parse(v))
  .handler(async ({ data, context }) => {
    await assertRole(context, ["admin", "policy_owner", "curator"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("change_set_items")
      .update({
        atom_payload: data.atom_payload as never,
        review_status: "edited_approved",
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      } as never)
      .eq("id", data.itemId);
    await supabaseAdmin.from("audit_events").insert({
      event_type: "review.edited_approved", entity_type: "change_set_item", entity_id: data.itemId, actor: context.userId,
      payload: { edited: true } as never,
    } as never);
    return { ok: true };
  });

const RejectInput = z.object({ itemId: z.string().uuid(), reason: z.string().min(1) });
export const rejectItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => RejectInput.parse(v))
  .handler(async ({ data, context }) => {
    await assertRole(context, ["admin", "policy_owner", "curator"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("change_set_items")
      .update({
        review_status: "rejected",
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
        curator_notes: data.reason,
      } as never)
      .eq("id", data.itemId);
    await supabaseAdmin.from("audit_events").insert({
      event_type: "review.rejected", entity_type: "change_set_item", entity_id: data.itemId, actor: context.userId,
      payload: { reason: data.reason } as never,
    } as never);
    return { ok: true };
  });

const ConfirmScopeInput = z.object({
  itemId: z.string().uuid(),
  dimension: z.enum([
    "process",
    "activities",
    "roles",
    "business_objects",
    "organizational_scope.company_codes",
    "organizational_scope.subsidiaries",
    "organizational_scope.plants",
  ]),
  value: z.array(z.string()).nullable(),
  status: z.enum(["explicit", "inherited", "inferred", "not_stated"]),
});
export const confirmScopeDimension = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => ConfirmScopeInput.parse(v))
  .handler(async ({ data, context }) => {
    await assertRole(context, ["admin", "policy_owner", "curator"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: item } = await supabaseAdmin.from("change_set_items").select("atom_payload").eq("id", data.itemId).single();
    if (!item) throw new Error("Item not found");
    const atom = item.atom_payload as unknown as ProcessAtom;
    const app = { ...(atom.applicability ?? {}) } as Record<string, unknown>;
    const confirmed = {
      value: data.value,
      status: data.status,
      requires_review: false,
      human_confirmed_by: context.userId,
      human_confirmed_at: new Date().toISOString(),
    };
    if (data.dimension.startsWith("organizational_scope.")) {
      const sub = data.dimension.split(".")[1] as "company_codes" | "subsidiaries" | "plants";
      const orgs = { ...((app.organizational_scope as Record<string, unknown> | undefined) ?? {}) };
      orgs[sub] = confirmed;
      app.organizational_scope = orgs;
    } else {
      app[data.dimension] = confirmed;
    }
    const updated: ProcessAtom = { ...atom, applicability: app as unknown as ProcessAtom["applicability"] };
    await supabaseAdmin.from("change_set_items").update({ atom_payload: updated as never } as never).eq("id", data.itemId);
    await supabaseAdmin.from("audit_events").insert({
      event_type: "review.scope_confirmed", entity_type: "change_set_item", entity_id: data.itemId, actor: context.userId,
      payload: { dimension: data.dimension, value: data.value, status: data.status } as never,
    } as never);
    return { ok: true };
  });

const ResolveInput = z.object({
  itemId: z.string().uuid(),
  strategy: z.string().min(1),
  winning: z.enum(["draft", "existing"]),
  reason: z.string().min(1),
});
export const resolveConflictOnItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => ResolveInput.parse(v))
  .handler(async ({ data, context }) => {
    await assertRole(context, ["admin", "policy_owner"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: item } = await supabaseAdmin
      .from("change_set_items")
      .select("id, atom_payload, existing_atom, conflict_findings")
      .eq("id", data.itemId)
      .single();
    if (!item) throw new Error("Item not found");
    const atom = item.atom_payload as unknown as ProcessAtom;
    const findings = (item.conflict_findings as unknown as { verdict: string; neighbor_db_id: string; neighbor_atom_id: string }[]) ?? [];
    const conflict = findings.find((f) => f.verdict === "overlap_conflict");
    if (!conflict) throw new Error("No conflict on this item");

    // Persist a conflicts row + resolutions row
    const { data: cRow } = await supabaseAdmin.from("conflicts").insert({
      atom_a: conflict.neighbor_db_id,
      atom_b_atom_id: atom.identity.atom_id,
      conflict_kind: "incompatible_action",
      detail: { source: "review", finding: conflict } as never,
      status: "open",
    } as never).select("id").single();
    if (cRow) {
      const winningAtomId = data.winning === "draft" ? atom.identity.atom_id : conflict.neighbor_atom_id;
      await supabaseAdmin.from("resolutions").insert({
        conflict_id: cRow.id, strategy: data.strategy, winning_atom_id: winningAtomId,
        reason: data.reason, approved_by: context.userId,
      } as never);
      await supabaseAdmin.from("conflicts").update({ status: "resolved" } as never).eq("id", cRow.id);
    }

    // Progress the item based on the winner
    if (data.winning === "existing") {
      await supabaseAdmin.from("change_set_items").update({
        review_status: "rejected", operation: "no_change",
        reviewed_by: context.userId, reviewed_at: new Date().toISOString(),
        curator_notes: `Conflict resolved in favour of existing atom via ${data.strategy}: ${data.reason}`,
      } as never).eq("id", data.itemId);
    } else {
      await supabaseAdmin.from("change_set_items").update({
        review_status: "approved", operation: "modify", existing_atom: conflict.neighbor_db_id,
        reviewed_by: context.userId, reviewed_at: new Date().toISOString(),
        curator_notes: `Conflict resolved in favour of draft via ${data.strategy}: ${data.reason}`,
      } as never).eq("id", data.itemId);
    }
    await supabaseAdmin.from("audit_events").insert({
      event_type: "review.conflict_resolved", entity_type: "change_set_item", entity_id: data.itemId, actor: context.userId,
      payload: { strategy: data.strategy, winning: data.winning, reason: data.reason } as never,
    } as never);
    return { ok: true };
  });

export const generateScenariosForItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => ItemId.parse(v))
  .handler(async ({ data, context }) => {
    await assertRole(context, ["admin", "policy_owner", "curator", "viewer"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { generateScenarios } = await import("@/lib/pipeline/scenarios.server");
    const { data: item } = await supabaseAdmin.from("change_set_items").select("atom_payload").eq("id", data.itemId).single();
    if (!item) throw new Error("Item not found");
    const scenarios = await generateScenarios(item.atom_payload as unknown as ProcessAtom);
    await supabaseAdmin.from("change_set_items").update({ scenarios: scenarios as never } as never).eq("id", data.itemId);
    return scenarios;
  });

const CsInput = z.object({ changeSetId: z.string().uuid() });
export const applyChangeSetFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => CsInput.parse(v))
  .handler(async ({ data, context }) => {
    await assertRole(context, ["admin", "policy_owner"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { applyChangeSet, PublicationBlockedError } = await import("@/lib/pipeline/publish.server");
    try {
      return await applyChangeSet(supabaseAdmin, data.changeSetId, context.userId);
    } catch (e) {
      if (e instanceof PublicationBlockedError) {
        return { error: "publication_blocked", blockers: e.blockers } as const;
      }
      throw e;
    }
  });

export const listPendingChangeSets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertRole(context, ["admin", "policy_owner", "curator", "viewer"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("change_sets")
      .select("id, source_id, status, summary, created_at, sources(title)")
      .in("status", ["pending_review", "partially_applied"])
      .order("created_at", { ascending: false });
    const withCounts = await Promise.all((data ?? []).map(async (cs) => {
      const { count: total } = await supabaseAdmin.from("change_set_items").select("id", { count: "exact", head: true }).eq("change_set_id", cs.id);
      const { count: pending } = await supabaseAdmin.from("change_set_items").select("id", { count: "exact", head: true }).eq("change_set_id", cs.id).eq("review_status", "pending");
      const { count: conflict } = await supabaseAdmin.from("change_set_items").select("id", { count: "exact", head: true }).eq("change_set_id", cs.id).eq("operation", "conflict_review");
      return { ...cs, total: total ?? 0, pending: pending ?? 0, conflict: conflict ?? 0 };
    }));
    return withCounts;
  });

const CsDetailInput = z.object({ changeSetId: z.string().uuid() });
export const getChangeSetDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => CsDetailInput.parse(v))
  .handler(async ({ data, context }) => {
    await assertRole(context, ["admin", "policy_owner", "curator", "viewer"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cs } = await supabaseAdmin.from("change_sets")
      .select("id, source_id, status, summary, created_at, sources(id, title, source_type, authority_class)")
      .eq("id", data.changeSetId).single();
    const { data: items } = await supabaseAdmin.from("change_set_items")
      .select("id, operation, review_status, curator_notes, existing_atom, atom_payload, neighbors, conflict_findings, scenarios, reviewed_at, reviewed_by")
      .eq("change_set_id", data.changeSetId)
      .order("created_at", { ascending: true });
    return { changeSet: cs, items: items ?? [] };
  });

export const listPrecedenceStrategies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("precedence_strategies")
      .select("id, name, description, priority_order, enabled")
      .eq("enabled", true).order("priority_order", { ascending: true });
    return data ?? [];
  });
