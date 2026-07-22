import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CategoryEnum = z.enum([
  "corporate_function",
  "end_to_end_process",
  "process",
  "activity",
  "business_object",
  "role",
  "system",
  "organizational_unit",
]);

async function requireCurator(context: { supabase: import("@supabase/supabase-js").SupabaseClient; userId: string }) {
  const { data } = await context.supabase.rpc("has_any_role", {
    _roles: ["admin", "policy_owner", "curator"],
    _user_id: context.userId,
  });
  if (!data) throw new Error("Forbidden: curator+ role required");
}

const CreateInput = z.object({
  category: CategoryEnum,
  value: z.string().min(1).max(80).regex(/^[a-z0-9_]+$/, "Use lower_snake_case"),
  label: z.string().min(1).max(120),
  parent_id: z.string().uuid().nullable().optional(),
});

export const createDomainEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => CreateInput.parse(v))
  .handler(async ({ data, context }) => {
    await requireCurator(context);
    const { data: row, error } = await context.supabase
      .from("domain_model")
      .insert({ category: data.category, value: data.value, label: data.label, parent_id: data.parent_id ?? null })
      .select("*")
      .single();
    if (error) throw error;
    return row;
  });

const UpdateInput = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(120).optional(),
  parent_id: z.string().uuid().nullable().optional(),
});

export const updateDomainEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => UpdateInput.parse(v))
  .handler(async ({ data, context }) => {
    await requireCurator(context);
    const patch: { label?: string; parent_id?: string | null } = {};
    if (data.label !== undefined) patch.label = data.label;
    if (data.parent_id !== undefined) patch.parent_id = data.parent_id;
    const { error } = await context.supabase.from("domain_model").update(patch).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const deleteDomainEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    await requireCurator(context);
    const { error } = await context.supabase.from("domain_model").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

const ProposalDecision = z.object({
  id: z.string().uuid(),
  decision: z.enum(["accept", "reject"]),
});

export const decideTagProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => ProposalDecision.parse(v))
  .handler(async ({ data, context }) => {
    await requireCurator(context);
    const { data: prop, error } = await context.supabase
      .from("tag_proposals")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error || !prop) throw error ?? new Error("Proposal not found");

    if (data.decision === "accept") {
      const { error: insErr } = await context.supabase
        .from("domain_model")
        .upsert(
          { category: prop.category, value: prop.value, label: prop.label },
          { onConflict: "category,value", ignoreDuplicates: true },
        );
      if (insErr) throw insErr;
    }
    await context.supabase
      .from("tag_proposals")
      .update({
        status: data.decision === "accept" ? "accepted" : "rejected",
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    return { ok: true };
  });

// ============ Roles ============

const RoleEnum = z.enum(["admin", "policy_owner", "curator", "reviewer", "viewer"]);

export const assignRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ user_id: z.string().uuid(), role: RoleEnum }).parse(v))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _role: "admin", _user_id: context.userId });
    if (!isAdmin) throw new Error("Forbidden: admin required");
    const { error } = await context.supabase
      .from("user_roles")
      .upsert({ user_id: data.user_id, role: data.role }, { onConflict: "user_id,role", ignoreDuplicates: true });
    if (error) throw error;
    return { ok: true };
  });

export const revokeRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ user_id: z.string().uuid(), role: RoleEnum }).parse(v))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _role: "admin", _user_id: context.userId });
    if (!isAdmin) throw new Error("Forbidden: admin required");
    if (data.user_id === context.userId && data.role === "admin") {
      throw new Error("You cannot revoke your own admin role");
    }
    const { error } = await context.supabase
      .from("user_roles")
      .delete()
      .eq("user_id", data.user_id)
      .eq("role", data.role);
    if (error) throw error;
    return { ok: true };
  });

export const listAllUsersWithRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _role: "admin", _user_id: context.userId });
    if (!isAdmin) throw new Error("Forbidden: admin required");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: users, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) throw error;
    const { data: roleRows } = await supabaseAdmin.from("user_roles").select("user_id, role");
    const byUser = new Map<string, string[]>();
    for (const r of roleRows ?? []) {
      const arr = byUser.get(r.user_id) ?? [];
      arr.push(r.role);
      byUser.set(r.user_id, arr);
    }
    return users.users.map((u) => ({
      id: u.id,
      email: u.email ?? "",
      created_at: u.created_at,
      roles: byUser.get(u.id) ?? [],
    }));
  });

// ============ Precedence Strategies ============

export const setStrategyEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(v))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _role: "admin", _user_id: context.userId });
    if (!isAdmin) throw new Error("Forbidden: admin required");
    const { error } = await context.supabase
      .from("precedence_strategies")
      .update({ enabled: data.enabled })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const createStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z
      .object({ name: z.string().min(1).max(80), description: z.string().min(1).max(400) })
      .parse(v),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _role: "admin", _user_id: context.userId });
    if (!isAdmin) throw new Error("Forbidden: admin required");
    const { error } = await context.supabase
      .from("precedence_strategies")
      .insert({ name: data.name, description: data.description, enabled: false, priority_order: [] as never });
    if (error) throw error;
    return { ok: true };
  });

// ============ Atom relationships ============

const RelType = z.enum([
  "DUPLICATES", "OVERLAPS", "CONFLICTS_WITH", "SPECIALIZES", "GENERALIZES",
  "SUPERSEDES", "DEPENDS_ON", "EXCEPTION_TO", "DERIVED_FROM", "IMPLEMENTS",
]);

export const addRelationship = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z.object({
      from_atom: z.string().uuid(),
      to_atom_id: z.string().min(1),
      relationship_type: RelType,
      rationale: z.string().optional(),
    }).parse(v),
  )
  .handler(async ({ data, context }) => {
    await requireCurator(context);
    const { error } = await context.supabase.from("atom_relationships").insert({
      from_atom: data.from_atom,
      to_atom_id: data.to_atom_id,
      relationship_type: data.relationship_type,
      rationale: data.rationale ?? null,
      created_by: context.userId,
    });
    if (error) throw error;
    return { ok: true };
  });

export const removeRelationship = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    await requireCurator(context);
    const { error } = await context.supabase.from("atom_relationships").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });