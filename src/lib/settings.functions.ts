import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireAdmin(context: { supabase: unknown; userId: string }) {
  const supabase = context.supabase as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: boolean | null }> };
  const { data } = await supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (!data) throw new Error("Forbidden: admin role required");
}

export const updateLlmSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z.object({
      provider: z.enum(["lovable", "openai", "anthropic", "custom"]),
      model: z.string().min(1),
      embedding_provider: z.string().min(1),
      embedding_model: z.string().min(1),
      api_key_secret_name: z.string().nullable().optional(),
    }).parse(v),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("llm_settings")
      .update({
        provider: data.provider,
        model: data.model,
        embedding_provider: data.embedding_provider,
        embedding_model: data.embedding_model,
        api_key_secret_name: data.api_key_secret_name ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("singleton", true);
    if (error) throw error;
    return { ok: true };
  });

export const savePromptVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z.object({
      prompt_key: z.string().min(1),
      template: z.string().min(20),
      activate: z.boolean().default(true),
    }).parse(v),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: latest } = await supabaseAdmin
      .from("prompt_versions")
      .select("version")
      .eq("prompt_key", data.prompt_key)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (latest?.version ?? 0) + 1;
    if (data.activate) {
      await supabaseAdmin.from("prompt_versions").update({ active: false }).eq("prompt_key", data.prompt_key);
    }
    const { error } = await supabaseAdmin.from("prompt_versions").insert({
      prompt_key: data.prompt_key,
      version: nextVersion,
      template: data.template,
      active: data.activate,
    });
    if (error) throw error;
    return { version: nextVersion };
  });

export const activatePromptVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ prompt_key: z.string(), version: z.number().int().positive() }).parse(v))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("prompt_versions").update({ active: false }).eq("prompt_key", data.prompt_key);
    const { error } = await supabaseAdmin
      .from("prompt_versions")
      .update({ active: true })
      .eq("prompt_key", data.prompt_key)
      .eq("version", data.version);
    if (error) throw error;
    return { ok: true };
  });
