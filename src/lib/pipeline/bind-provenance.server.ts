/**
 * Stage 8 — Provenance binding (deterministic).
 * Locates each quoted_evidence span in the parsed document text, records exact
 * char offsets and hash. If a span cannot be located, derivation is downgraded
 * to "unknown" and the atom is flagged for groundedness validation.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ProcessAtom, QuotedEvidence } from "@/types/atom";
import type { DocumentLayout } from "./types";
import { PARSER_VERSION, EXTRACTOR_VERSION } from "./version";

async function sha256Hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function locate(fullText: string, needle: string): { start: number; end: number } | null {
  if (!needle || needle.trim().length < 8) return null;
  const idx = fullText.indexOf(needle);
  if (idx >= 0) return { start: idx, end: idx + needle.length };
  // Fuzzy: normalized whitespace/case
  const nText = normalize(fullText);
  const nNeedle = normalize(needle);
  const j = nText.indexOf(nNeedle);
  if (j >= 0) {
    // Map back approximately: search first significant word
    const first = needle.split(/\s+/).find((w) => w.length > 4) ?? needle.slice(0, 20);
    const k = fullText.indexOf(first);
    if (k >= 0) return { start: k, end: Math.min(fullText.length, k + needle.length) };
  }
  return null;
}

export interface ProvenanceOutcome {
  bound: number;
  unresolved: number;
  atoms_flagged: number;
}

export async function bindProvenanceForChangeSet(
  admin: SupabaseClient<Database>,
  changeSetId: string,
): Promise<ProvenanceOutcome> {
  const { data: cs } = await admin
    .from("change_sets")
    .select("source_id")
    .eq("id", changeSetId)
    .single();
  if (!cs?.source_id) return { bound: 0, unresolved: 0, atoms_flagged: 0 };

  const [{ data: src }, { data: doc }] = await Promise.all([
    admin.from("sources").select("id, source_id, title, source_type, version").eq("id", cs.source_id).single(),
    admin.from("source_documents").select("layout").eq("source_id", cs.source_id).maybeSingle(),
  ]);
  if (!src || !doc) return { bound: 0, unresolved: 0, atoms_flagged: 0 };
  const layout = doc.layout as unknown as DocumentLayout;
  const fullText = layout?.full_text ?? "";

  const { data: items } = await admin
    .from("change_set_items")
    .select("id, atom_payload")
    .eq("change_set_id", changeSetId);
  if (!items) return { bound: 0, unresolved: 0, atoms_flagged: 0 };

  let bound = 0;
  let unresolved = 0;
  let flagged = 0;
  const now = new Date().toISOString();

  for (const item of items) {
    const atom = item.atom_payload as unknown as ProcessAtom;
    if (!atom?.provenance) continue;
    const quoted: QuotedEvidence[] = Array.isArray(atom.provenance.quoted_evidence)
      ? atom.provenance.quoted_evidence
      : [];
    let atomHasUnresolved = false;
    const updatedEvidence: QuotedEvidence[] = [];
    let firstStart: number | undefined;
    let firstEnd: number | undefined;
    let evidenceHashInput = "";

    for (const q of quoted) {
      const loc = locate(fullText, q.text ?? "");
      if (loc) {
        updatedEvidence.push({ ...q, character_start: loc.start, character_end: loc.end });
        if (firstStart === undefined) {
          firstStart = loc.start;
          firstEnd = loc.end;
        }
        evidenceHashInput += fullText.slice(loc.start, loc.end) + "\n";
        bound++;
      } else {
        updatedEvidence.push({ ...q, character_start: undefined, character_end: undefined });
        atomHasUnresolved = true;
        unresolved++;
      }
    }

    const hash = evidenceHashInput ? await sha256Hex(evidenceHashInput) : "unresolved";

    // Attach/complete provenance
    const provenance = {
      ...atom.provenance,
      source_id: src.id,
      source_type: src.source_type,
      source_title: src.title,
      source_version: src.version ?? "1",
      quoted_evidence: updatedEvidence,
      character_start: firstStart,
      character_end: firstEnd,
      source_text_hash: hash,
      ingestion_timestamp: atom.provenance.ingestion_timestamp || now,
      parser_version: PARSER_VERSION,
      extractor_version: EXTRACTOR_VERSION,
      extraction_model: atom.provenance.extraction_model ?? "unknown",
      extraction_prompt_version: atom.provenance.extraction_prompt_version ?? "unknown",
    };

    let purpose = atom.purpose;
    if (atomHasUnresolved && purpose) {
      // Downgrade purpose derivation if entirely unsupported
      const anyBound = updatedEvidence.some((e) => e.character_start !== undefined);
      if (!anyBound) purpose = { ...purpose, derivation: "unknown" };
    }
    if (atomHasUnresolved) flagged++;

    const updated: ProcessAtom = { ...atom, provenance, purpose };
    await admin.from("change_set_items").update({ atom_payload: updated as never }).eq("id", item.id);
  }

  return { bound, unresolved, atoms_flagged: flagged };
}