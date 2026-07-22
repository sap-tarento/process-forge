import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { chat, parseJsonLoose } from "./llm-gateway.server";
import { loadLlmSettings, loadActivePrompt } from "./settings.server";

interface DetectedSpan {
  span_text: string;
  linguistic_form: Database["public"]["Enums"]["linguistic_form"];
  detection_confidence: number;
}

const VALID_FORMS = new Set([
  "explicit_obligation",
  "prohibition",
  "conditional_obligation",
  "exception",
  "responsibility_assignment",
  "implicit_requirement",
]);

export interface DetectSpansOpts {
  batchSize?: number;
  wipe?: boolean;
}

export async function detectSpansForSource(
  admin: SupabaseClient<Database>,
  sourceId: string,
  opts: DetectSpansOpts = {},
): Promise<{ detected: number; windows_processed: number; remaining: number }> {
  const settings = await loadLlmSettings();
  const prompt = await loadActivePrompt("span_detection");
  const batchSize = opts.batchSize ?? 3;

  if (opts.wipe) {
    const { error: delErr } = await admin.from("candidate_spans").delete().eq("source_id", sourceId);
    if (delErr) throw delErr;
    // Reset cursor so we reprocess all windows this run
    const { error: rstErr } = await admin
      .from("context_windows")
      .update({ spans_detected_at: null } as never)
      .eq("source_id", sourceId);
    if (rstErr) throw rstErr;
  }

  const { data: windows, error } = await admin
    .from("context_windows")
    .select("id, local_text, preceding_paragraph, following_paragraph, section_context")
    .eq("source_id", sourceId)
    .is("spans_detected_at", null)
    .order("id", { ascending: true })
    .limit(batchSize);
  if (error) throw error;

  let detected = 0;
  let processed = 0;
  for (const w of windows ?? []) {
    // Skip trivially short blocks
    if (!w.local_text || w.local_text.trim().length < 20) {
      await admin.from("context_windows").update({ spans_detected_at: new Date().toISOString() } as never).eq("id", w.id);
      processed++;
      continue;
    }
    const section = w.section_context as { heading_path?: string[]; page?: number } | null;
    const userPayload = {
      HEADING_PATH: section?.heading_path ?? [],
      PAGE: section?.page,
      PRECEDING_PARAGRAPH: w.preceding_paragraph ?? "",
      LOCAL_TEXT: w.local_text,
      FOLLOWING_PARAGRAPH: w.following_paragraph ?? "",
    };

    try {
      const res = await chat({
        settings,
        promptKey: "span_detection",
        promptVersion: prompt.version,
        json: true,
        messages: [
          { role: "system", content: prompt.template },
          { role: "user", content: JSON.stringify(userPayload, null, 2) },
        ],
      });
      const parsed = parseJsonLoose<{ spans?: DetectedSpan[] }>(res.content);
      const spans = Array.isArray(parsed.spans) ? parsed.spans : [];
      const rows = spans
        .filter((s) => s && typeof s.span_text === "string" && VALID_FORMS.has(s.linguistic_form))
        .map((s) => ({
          context_window_id: w.id,
          source_id: sourceId,
          span_text: s.span_text.slice(0, 4000),
          linguistic_form: s.linguistic_form,
          detection_confidence: Math.max(0, Math.min(1, Number(s.detection_confidence) || 0.5)),
        }));
      if (rows.length) {
        const { error: insErr } = await admin.from("candidate_spans").insert(rows);
        if (!insErr) detected += rows.length;
      }
    } catch (e) {
      console.error(`span_detection failed for window ${w.id}:`, e);
    }
    await admin.from("context_windows").update({ spans_detected_at: new Date().toISOString() } as never).eq("id", w.id);
    processed++;
  }

  const { count } = await admin
    .from("context_windows")
    .select("id", { count: "exact", head: true })
    .eq("source_id", sourceId)
    .is("spans_detected_at", null);

  return { detected, windows_processed: processed, remaining: count ?? 0 };
}
