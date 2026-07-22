import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { chat, parseJsonLoose } from "./llm-gateway.server";
import { loadLlmSettings, loadActivePrompt } from "./settings.server";
import { coerceAndValidate } from "./atom-validation.server";
import { PARSER_VERSION, EXTRACTOR_VERSION } from "./version";
import type { ProcessAtom } from "@/types/atom";

const DESCRIPTIVE_TYPES = new Set(["EVENT_LOG", "AGENT_TRACE"]);

export async function extractAtomsForSource(
  admin: SupabaseClient<Database>,
  sourceId: string,
  changeSetId: string,
): Promise<{ produced: number; blocked: number }> {
  const settings = await loadLlmSettings();
  const prompt = await loadActivePrompt("extraction");

  const { data: src } = await admin.from("sources").select("*").eq("id", sourceId).single();
  if (!src) throw new Error("Source not found");
  const isDescriptive = DESCRIPTIVE_TYPES.has(src.source_type);

  const { data: spans } = await admin
    .from("candidate_spans")
    .select(`
      id, span_text, linguistic_form, detection_confidence,
      context_window:context_windows!inner (
        id, local_text, preceding_paragraph, following_paragraph, section_context, document_context, char_start, char_end
      )
    `)
    .eq("source_id", sourceId);

  if (!spans || spans.length === 0) return { produced: 0, blocked: 0 };

  let produced = 0;
  let blocked = 0;

  for (const s of spans) {
    const cw = (s as unknown as { context_window: { local_text: string; preceding_paragraph: string | null; following_paragraph: string | null; section_context: { heading_path?: string[]; page?: number } | null; document_context: unknown } }).context_window;
    const section = cw.section_context ?? {};

    const payload = {
      SPAN_TEXT: s.span_text,
      LINGUISTIC_FORM: s.linguistic_form,
      DOCUMENT_CONTEXT: cw.document_context,
      HEADING_PATH: section.heading_path ?? [],
      PAGE: section.page,
      PRECEDING_PARAGRAPH: cw.preceding_paragraph,
      LOCAL_TEXT: cw.local_text,
      FOLLOWING_PARAGRAPH: cw.following_paragraph,
      SOURCE_TITLE: src.title,
      SOURCE_TYPE: src.source_type,
      SOURCE_VERSION: src.version ?? "1",
      IS_DESCRIPTIVE: isDescriptive,
    };

    let modelAtoms: unknown[] = [];
    try {
      const res = await chat({
        settings,
        promptKey: "extraction",
        promptVersion: prompt.version,
        json: true,
        messages: [
          { role: "system", content: prompt.template },
          { role: "user", content: JSON.stringify(payload, null, 2) },
        ],
      });
      const parsed = parseJsonLoose<{ atoms?: unknown[] }>(res.content);
      if (Array.isArray(parsed.atoms)) modelAtoms = parsed.atoms;
    } catch (e) {
      console.error(`extraction failed for span ${s.id}:`, e);
      continue;
    }

    for (const raw of modelAtoms) {
      const outcome = coerceAndValidate(raw, {
        source_id: src.id,
        source_title: src.title,
        source_type: src.source_type as ProcessAtom["provenance"]["source_type"],
        source_version: src.version ?? "1",
        source_text_hash: src.text_hash ?? "unknown",
        parser_version: PARSER_VERSION,
        extractor_version: EXTRACTOR_VERSION,
        extraction_model: `${settings.provider}/${settings.model}`,
        extraction_prompt_version: `extraction@v${prompt.version}`,
        page: section.page,
        section: Array.isArray(section.heading_path) ? section.heading_path.join(" / ") : undefined,
        isDescriptive,
      });

      if (!outcome.passed) blocked++;

      // Insert as change_set_items (candidate — needs review)
      const { error } = await admin.from("change_set_items").insert({
        change_set_id: changeSetId,
        operation: "add",
        atom_payload: outcome.atom as never,
        validation_results: outcome.atom.quality.validations as never,
        review_status: outcome.passed ? "pending" : "needs_changes",
        curator_notes: outcome.passed ? null : `Blocked by validation: ${outcome.issues.join("; ")}`,
      });
      if (!error) produced++;
    }
  }

  return { produced, blocked };
}
