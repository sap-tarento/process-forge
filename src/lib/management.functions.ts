/**
 * Management + hard-delete server functions.
 * Every mutation is role-gated and writes an append-only audit_events row per affected entity.
 * Published active atoms are never removed as a side-effect of source/run/change-set deletes.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const IdsInput = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });

async function assertRole(context: { supabase: any; userId: string }, roles: string[]) {
  const { data } = await context.supabase.rpc("has_any_role", { _roles: roles, _user_id: context.userId });
  if (!data) throw new Error(`Forbidden: requires one of ${roles.join(", ")}`);
}

async function audit(
  admin: any,
  actor: string,
  event_type: string,
  entity_type: string,
  entity_id: string,
  payload: Record<string, unknown>,
) {
  await admin.from("audit_events").insert({
    event_type,
    entity_type,
    entity_id,
    actor,
    payload: payload as never,
  } as never);
}

export const deleteSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => IdsInput.parse(v))
  .handler(async ({ data, context }) => {
    await assertRole(context, ["admin"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const deleted: string[] = [];
    const blocked: { source_id: string; active_count: number }[] = [];

    for (const id of data.ids) {
      const { data: src } = await supabaseAdmin
        .from("sources")
        .select("id, source_id, title, file_path")
        .eq("id", id)
        .maybeSingle();
      if (!src) continue;

      const { count: activeCount } = await supabaseAdmin
        .from("atoms")
        .select("id", { count: "exact", head: true })
        .eq("source_id", id)
        .eq("status", "active");
      if ((activeCount ?? 0) > 0) {
        blocked.push({ source_id: src.source_id, active_count: activeCount ?? 0 });
        continue;
      }

      // Best-effort remove storage object
      if (src.file_path) {
        try {
          await supabaseAdmin.storage.from("source-files").remove([src.file_path]);
        } catch {
          /* ignore */
        }
      }

      // Clean orphan conflicts hanging off items about to cascade-delete
      const { data: csRows } = await supabaseAdmin
        .from("change_sets")
        .select("id")
        .eq("source_id", id);
      const csIds = (csRows ?? []).map((r) => r.id);
      if (csIds.length) {
        const { data: itemRows } = await supabaseAdmin
          .from("change_set_items")
          .select("id")
          .in("change_set_id", csIds);
        const itemIds = (itemRows ?? []).map((r) => r.id);
        if (itemIds.length) {
          for (const iid of itemIds) {
            await supabaseAdmin
              .from("conflicts")
              .delete()
              .filter("detail->>change_set_item_id", "eq", iid);
          }
        }
        await supabaseAdmin.from("change_sets").delete().in("id", csIds);
      }

      const { error } = await supabaseAdmin.from("sources").delete().eq("id", id);
      if (error) throw new Error(`Failed to delete source ${src.source_id}: ${error.message}`);

      await audit(supabaseAdmin, context.userId, "source.deleted", "source", id, {
        source_id: src.source_id,
        title: src.title,
        cascade_note:
          "Cascaded parsed windows, spans, source_documents, pipeline_runs, and change_sets. Any non-active atoms had source_id set to null.",
      });
      deleted.push(id);
    }

    return { deleted, blocked };
  });

export const deletePipelineRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => IdsInput.parse(v))
  .handler(async ({ data, context }) => {
    await assertRole(context, ["admin", "curator", "policy_owner"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const deleted: string[] = [];
    for (const id of data.ids) {
      const { data: run } = await supabaseAdmin
        .from("pipeline_runs")
        .select("id, source_id, status, change_set_id")
        .eq("id", id)
        .maybeSingle();
      if (!run) continue;
      const { error } = await supabaseAdmin.from("pipeline_runs").delete().eq("id", id);
      if (error) throw new Error(`Failed to delete pipeline run: ${error.message}`);
      await audit(supabaseAdmin, context.userId, "pipeline_run.deleted", "pipeline_run", id, {
        source_id: run.source_id,
        status: run.status,
        change_set_kept: run.change_set_id,
      });
      deleted.push(id);
    }
    return { deleted };
  });

export const deleteChangeSets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => IdsInput.parse(v))
  .handler(async ({ data, context }) => {
    await assertRole(context, ["admin", "curator", "policy_owner"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const deleted: string[] = [];

    for (const id of data.ids) {
      const { data: cs } = await supabaseAdmin
        .from("change_sets")
        .select("id, source_id, status")
        .eq("id", id)
        .maybeSingle();
      if (!cs) continue;

      const { data: itemRows } = await supabaseAdmin
        .from("change_set_items")
        .select("id")
        .eq("change_set_id", id);
      const itemIds = (itemRows ?? []).map((r) => r.id);

      // conflicts has no FK to change_set_items → clean explicitly by detail.change_set_item_id
      for (const iid of itemIds) {
        await supabaseAdmin
          .from("conflicts")
          .delete()
          .filter("detail->>change_set_item_id", "eq", iid);
      }

      const { error } = await supabaseAdmin.from("change_sets").delete().eq("id", id);
      if (error) throw new Error(`Failed to delete change set: ${error.message}`);

      await audit(supabaseAdmin, context.userId, "change_set.deleted", "change_set", id, {
        source_id: cs.source_id,
        status: cs.status,
        item_count: itemIds.length,
      });
      deleted.push(id);
    }
    return { deleted };
  });

export const withdrawAtoms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => IdsInput.parse(v))
  .handler(async ({ data, context }) => {
    await assertRole(context, ["admin", "curator", "policy_owner"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const withdrawn: string[] = [];
    const now = new Date().toISOString();
    for (const id of data.ids) {
      const { data: atom } = await supabaseAdmin
        .from("atoms")
        .select("id, atom_id, version, status")
        .eq("id", id)
        .maybeSingle();
      if (!atom) continue;
      const { error } = await supabaseAdmin
        .from("atoms")
        .update({ status: "withdrawn", valid_to: now } as never)
        .eq("id", id);
      if (error) throw new Error(`Failed to withdraw atom ${atom.atom_id}: ${error.message}`);
      await audit(supabaseAdmin, context.userId, "atom.withdrawn", "atom", id, {
        atom_id: atom.atom_id,
        version: atom.version,
        previous_status: atom.status,
      });
      withdrawn.push(id);
    }
    return { withdrawn };
  });

export const deleteAtoms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => IdsInput.parse(v))
  .handler(async ({ data, context }) => {
    await assertRole(context, ["admin"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const deleted: string[] = [];
    for (const id of data.ids) {
      const { data: atom } = await supabaseAdmin
        .from("atoms")
        .select("id, atom_id, version, status")
        .eq("id", id)
        .maybeSingle();
      if (!atom) continue;
      const { error } = await supabaseAdmin.from("atoms").delete().eq("id", id);
      if (error) throw new Error(`Failed to delete atom ${atom.atom_id}: ${error.message}`);
      await audit(supabaseAdmin, context.userId, "atom.deleted", "atom", id, {
        atom_id: atom.atom_id,
        version: atom.version,
        previous_status: atom.status,
      });
      deleted.push(id);
    }
    return { deleted };
  });