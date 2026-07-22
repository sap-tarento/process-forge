import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { LlmSettings } from "./llm-gateway.server";

export async function loadLlmSettings(): Promise<LlmSettings> {
  const { data, error } = await supabaseAdmin
    .from("llm_settings")
    .select("*")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("LLM settings row missing");
  return {
    provider: data.provider,
    model: data.model,
    embedding_provider: data.embedding_provider,
    embedding_model: data.embedding_model,
    api_key_secret_name: data.api_key_secret_name,
    base_url: null,
  };
}

export async function loadActivePrompt(promptKey: string): Promise<{ template: string; version: number }> {
  const { data, error } = await supabaseAdmin
    .from("prompt_versions")
    .select("template, version")
    .eq("prompt_key", promptKey)
    .eq("active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No active prompt for key "${promptKey}"`);
  return { template: data.template, version: data.version };
}
