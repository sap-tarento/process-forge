import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { chatJson } from "./llm-gateway.server";
import { loadLlmSettings, loadActivePrompt } from "./settings.server";
import { coerceAndValidate } from "./atom-validation.server";
import { PARSER_VERSION, EXTRACTOR_VERSION } from "./version";
import type { ProcessAtom } from "@/types/atom";

const DESCRIPTIVE_TYPES = new Set(["EVENT_LOG", "AGENT_TRACE"]);

interface RawAtom {
  identity?: { atom_id?: unknown; name?: unknown };
  action?: { operation?: unknown; object?: unknown };
  provenance?: { quoted_evidence?: unknown };
  [k: string]: unknown;
}

function validateExtractionShape(
  v: unknown,
): { ok: true; value: { atoms: RawAtom[] } } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!v || typeof v !== "object") return { ok: false, errors: ["response is not an object"] };
  const obj = v as { atoms?: unknown };
  if (!Array.isArray(obj.atoms)) return { ok: false, errors: ["missing top-level `atoms` array"] };
  const atoms = obj.atoms as RawAtom[];
  atoms.forEach((a, i) => {
    if (!a || typeof a !== "object") {
      errors.push(`atoms[${i}] is not an object`);
      return;
    }
    const id = a.identity ?? {};
    if (typeof id.name !== "string" || id.name.trim().length === 0) {
      errors.push(`atoms[${i}].identity.name is required (non-empty string)`);
    }
    if (typeof id.atom_id !== "string" || id.atom_id.trim().length === 0) {
      errors.push(`atoms[${i}].identity.atom_id is required (dotted lowercase slug)`);
    }
    const act = a.action ?? {};
    if (typeof act.operation !== "string" || act.operation.trim().length === 0) {
      errors.push(`atoms[${i}].action.operation is required`);
    }
    if (typeof act.object !== "string" || act.object.trim().length === 0) {
      errors.push(`atoms[${i}].action.object is required`);
    }
    const prov = a.provenance ?? {};
    const qe = (prov as { quoted_evidence?: unknown }).quoted_evidence;
    if (!Array.isArray(qe) || qe.length === 0) {
      errors.push(`atoms[${i}].provenance.quoted_evidence must have at least one entry`);
    }
  });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { atoms } };
}

export async function extractAtomsForSource(
  admin: SupabaseClient<Database>,
  sourceId: string,
  changeSetId: string,
  opts: { batchSize?: number } = {},
): Promise<{ produced: number; blocked: number; remaining: number }> {
  const batchSize = opts.batchSize ?? 3;
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
    .eq("source_id", sourceId)
    .eq("status", "pending")
    .order("id", { ascending: true })
    .limit(batchSize);

  if (!spans || spans.length === 0) {
    return { produced: 0, blocked: 0, remaining: 0 };
  }

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

    let modelAtoms: RawAtom[] = [];
    let spanFailed = false;
    let failureReason: string | null = null;
    let rawResponse: string | null = null;
    try {
      const { value, result } = await chatJson(
        {
          settings,
          promptKey: "extraction",
          promptVersion: prompt.version,
          json: true,
          messages: [
            { role: "system", content: prompt.template },
            { role: "user", content: JSON.stringify(payload, null, 2) },
          ],
        },
        validateExtractionShape,
      );
      modelAtoms = value.atoms;
      rawResponse = result.content;
    } catch (e) {
      spanFailed = true;
      failureReason = e instanceof Error ? e.message : String(e);
      console.error(`extraction failed for span ${s.id}:`, failureReason);
    }

    // If the model returned no usable atoms after retry, reject the span and
    // record the failure — do NOT insert hollow default atoms.
    if (spanFailed || modelAtoms.length === 0) {
      const { data: cs } = await admin
        .from("change_sets")
        .select("id")
        .eq("id", changeSetId)
        .single();
      if (cs) {
        await admin.from("change_set_items").insert({
          change_set_id: changeSetId,
          operation: "no_change",
          atom_payload: {} as never,
          validation_results: [] as never,
          review_status: "rejected",
          curator_notes: spanFailed
            ? `Extraction skipped: model response did not match the ProcessAtom shape after retry. ${failureReason ?? ""}`.trim()
            : "Extraction returned no atoms for this span.",
          extraction_debug: {
            span_id: s.id,
            span_text: s.span_text,
            failure_reason: failureReason,
            raw_response: rawResponse,
          } as never,
        });
      }
      await admin
        .from("candidate_spans")
        .update({ status: "rejected" } as never)
        .eq("id", s.id);
      continue;
    }

    for (const raw of modelAtoms) {
      const outcome = coerceAndValidate(raw, {
        source_id: src.id,
        source_title: src.title,
        source_type: src.source_type as ProcessAtom["provenance"]["source_type"],
        source_version: src.version ?? "1",
        source_text_hash: src.file_sha256 ?? "unknown",
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
        review_status: "pending",
        curator_notes: outcome.passed ? null : `Blocked by validation: ${outcome.issues.join("; ")}`,
        extraction_debug: {
          span_id: s.id,
          raw_atom: raw,
        } as never,
      });
      if (!error) produced++;
    }

    await admin
      .from("candidate_spans")
      .update({ status: "accepted" } as never)
      .eq("id", s.id);
  }

  const { count } = await admin
    .from("candidate_spans")
    .select("id", { count: "exact", head: true })
    .eq("source_id", sourceId)
    .eq("status", "pending");

  return { produced, blocked, remaining: count ?? 0 };
}
