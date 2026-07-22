/**
 * Stage 9 — Quality validation (the paper's 4 layers).
 *   1. schema (deterministic)
 *   2. semantic_completeness (LLM checklist)
 *   3. atomicity (heuristic + score)
 *   4. groundedness (evidence supports every claim)
 *
 * Results are appended to each atom.quality.validations and mirrored onto
 * change_set_items.validation_results.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ProcessAtom, ValidationResult } from "@/types/atom";
import { chat, parseJsonLoose } from "./llm-gateway.server";
import { loadLlmSettings, loadActivePrompt } from "./settings.server";

const ISO_RE = /^\d{4}-\d{2}-\d{2}/;
const ATOM_ID_RE = /^[a-z0-9]+(\.[a-z0-9._-]+)+$/;

function schemaLayer(atom: ProcessAtom): ValidationResult {
  const issues: string[] = [];
  if (!atom.identity?.atom_id || !ATOM_ID_RE.test(atom.identity.atom_id))
    issues.push("identity.atom_id must be a dotted lowercase slug (e.g. procurement.pr.cost-center-required)");
  if (!atom.identity?.name) issues.push("identity.name is missing");
  if (!atom.knowledge_type) issues.push("knowledge_type is missing");
  if (!["MUST", "MUST_NOT", "MAY"].includes(atom.action?.modality)) issues.push("action.modality is invalid");
  if (!atom.action?.actor) issues.push("action.actor is missing");
  if (!atom.action?.operation) issues.push("action.operation is missing");
  if (!atom.action?.object) issues.push("action.object is missing");
  const evidence = atom.provenance?.quoted_evidence ?? [];
  if (evidence.length === 0) issues.push("At least one evidence span is required");
  const tags = atom.domain_tags ?? ({} as ProcessAtom["domain_tags"]);
  const totalTags = Object.values(tags).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
  if (totalTags === 0) issues.push("At least one domain tag is required");
  const tScope = atom.applicability?.temporal_scope;
  if (tScope?.valid_from && !ISO_RE.test(tScope.valid_from)) issues.push("temporal_scope.valid_from is not ISO");
  if (tScope?.valid_to && !ISO_RE.test(tScope.valid_to)) issues.push("temporal_scope.valid_to is not ISO");
  for (const p of atom.applicability?.preconditions ?? []) {
    if (!p.field || !p.operator) { issues.push("A precondition is missing field or operator"); break; }
  }
  return { layer: "schema", passed: issues.length === 0, score: issues.length === 0 ? 1 : 0, issues };
}

function atomicityLayer(atom: ProcessAtom): ValidationResult {
  const issues: string[] = [];
  const evidenceText = (atom.provenance?.quoted_evidence ?? []).map((q) => q.text).join(" ");
  const words = evidenceText.split(/\s+/).filter(Boolean);
  // Signals
  const conjunctionSplits = (evidenceText.match(/\band also\b|; and |, and(?![^,]*or)/gi) ?? []).length;
  const multipleModalities = /\b(shall|must)\b[^.]*\band\b[^.]*\b(shall|must|may)\b/i.test(evidenceText);
  const tooLong = words.length > 90;
  const tooShort = words.length < 4;

  if (conjunctionSplits >= 2) issues.push(`Evidence chains ${conjunctionSplits + 1} independent clauses — consider splitting`);
  if (multipleModalities) issues.push("Multiple modalities detected in evidence — may combine independent rules");
  if (tooLong) issues.push(`Evidence is ${words.length} words — likely covers multiple rules`);
  if (tooShort) issues.push("Evidence is too short to carry business meaning");

  const score = Math.max(0, 1 - 0.2 * issues.length);
  return { layer: "atomicity", passed: issues.length === 0, score, issues };
}

function groundednessLayer(atom: ProcessAtom): ValidationResult {
  const issues: string[] = [];
  const evidence = atom.provenance?.quoted_evidence ?? [];
  const unresolved = evidence.filter((e) => e.character_start === undefined).length;
  if (unresolved > 0) issues.push(`${unresolved} evidence span(s) could not be located in the source document`);

  // Any Φ dimension with derivation "unknown" is a groundedness failure (hard gate at publication)
  const dims: Record<string, { derivation?: string; status?: string }> = {
    process: atom.applicability?.process?.evidence ?? { derivation: atom.applicability?.process?.status },
    activities: atom.applicability?.activities?.evidence ?? { derivation: atom.applicability?.activities?.status },
    roles: atom.applicability?.roles?.evidence ?? { derivation: atom.applicability?.roles?.status },
    business_objects: atom.applicability?.business_objects?.evidence ?? { derivation: atom.applicability?.business_objects?.status },
  };
  for (const [name, ev] of Object.entries(dims)) {
    if (ev?.derivation === "unknown") issues.push(`Applicability.${name} derivation is "unknown" — publication blocked until reviewed`);
  }

  if (atom.purpose?.derivation === "unknown") {
    issues.push("Purpose derivation is unknown — evidence does not support the stated purpose");
  }

  const passed = issues.length === 0;
  return { layer: "groundedness", passed, score: passed ? 1 : 0, issues };
}

async function semanticCompletenessLayer(atom: ProcessAtom): Promise<ValidationResult> {
  try {
    const settings = await loadLlmSettings();
    const prompt = await loadActivePrompt("semantic_completeness");
    const excerpt = (atom.provenance?.quoted_evidence ?? []).map((q) => q.text).join("\n").slice(0, 3000);
    const payload = {
      ATOM: {
        knowledge_type: atom.knowledge_type,
        action: atom.action,
        applicability: atom.applicability,
        purpose: atom.purpose,
      },
      SOURCE_EXCERPT: excerpt,
    };
    const res = await chat({
      settings,
      promptKey: "semantic_completeness",
      promptVersion: prompt.version,
      json: true,
      messages: [
        { role: "system", content: prompt.template },
        { role: "user", content: JSON.stringify(payload, null, 2) },
      ],
    });
    const parsed = parseJsonLoose<{
      answers?: { id: string; answer: "yes" | "no" | "partial"; reason?: string }[];
    }>(res.content);
    const answers = Array.isArray(parsed.answers) ? parsed.answers : [];
    const issues: string[] = [];
    let yes = 0;
    for (const a of answers) {
      if (a.answer === "yes") yes++;
      else issues.push(`${a.id}: ${a.answer} — ${a.reason ?? ""}`.trim());
    }
    const total = answers.length || 7;
    const score = total ? yes / total : 0;
    return {
      layer: "semantic_completeness",
      passed: score >= 0.85 && !answers.some((a) => a.answer === "no"),
      score,
      issues,
    };
  } catch (e) {
    return {
      layer: "semantic_completeness",
      passed: false,
      score: 0,
      issues: [`Validator failed: ${(e as Error).message}`],
    };
  }
}

export interface QualityOutcome {
  validated: number;
  publication_blocked: number;
  average_atomicity: number;
}

export async function validateQualityForChangeSet(
  admin: SupabaseClient<Database>,
  changeSetId: string,
): Promise<QualityOutcome> {
  const { data: items } = await admin
    .from("change_set_items")
    .select("id, atom_payload")
    .eq("change_set_id", changeSetId);
  if (!items) return { validated: 0, publication_blocked: 0, average_atomicity: 0 };

  let validated = 0;
  let blocked = 0;
  let atomicitySum = 0;

  for (const item of items) {
    const atom = item.atom_payload as unknown as ProcessAtom;
    if (!atom?.identity) continue;

    const schema = schemaLayer(atom);
    const atomicity = atomicityLayer(atom);
    const groundedness = groundednessLayer(atom);
    const semantic = await semanticCompletenessLayer(atom);

    const results: ValidationResult[] = [schema, semantic, atomicity, groundedness];
    const publicationBlocked = !groundedness.passed || !schema.passed;
    if (publicationBlocked) blocked++;
    atomicitySum += atomicity.score ?? 0;

    const quality = {
      ...(atom.quality ?? {}),
      atomicity_score: atomicity.score ?? 0,
      validations: results,
    };
    const updated: ProcessAtom = { ...atom, quality: quality as ProcessAtom["quality"] };

    await admin
      .from("change_set_items")
      .update({
        atom_payload: updated as never,
        validation_results: results as never,
        review_status: publicationBlocked ? "pending" : "pending",
        curator_notes: publicationBlocked
          ? `Publication blocked: ${[...schema.issues, ...groundedness.issues].slice(0, 3).join(" · ")}`
          : null,
      })
      .eq("id", item.id);

    validated++;
  }

  return {
    validated,
    publication_blocked: blocked,
    average_atomicity: validated ? +(atomicitySum / validated).toFixed(3) : 0,
  };
}