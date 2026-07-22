/**
 * Stage 7 — Enterprise domain grounding.
 * Assigns tags to each draft atom in a change_set from EXISTING vocabulary only,
 * records NEW vocabulary suggestions as tag_proposals (status="proposed"),
 * and computes/stores an atom embedding for retrieval.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { chat, embed, parseJsonLoose } from "./llm-gateway.server";
import { loadLlmSettings, loadActivePrompt } from "./settings.server";
import type { AtomDomainTags, ProcessAtom } from "@/types/atom";

type DomainCategory = Database["public"]["Enums"]["domain_category"];

const CATEGORIES: DomainCategory[] = [
  "corporate_function",
  "end_to_end_process",
  "process",
  "activity",
  "business_object",
  "role",
  "system",
  "organizational_unit",
];

function emptyTags(): AtomDomainTags {
  return {
    corporate_function: [],
    end_to_end_process: [],
    process: [],
    activity: [],
    business_object: [],
    role: [],
    system: [],
    organizational_unit: [],
  };
}

function serializeAtomForEmbedding(a: ProcessAtom): string {
  const parts = [
    `[${a.knowledge_type}] ${a.identity.name}`,
    `Action: ${a.action.modality} ${a.action.actor} ${a.action.operation} ${a.action.object}`,
    `Purpose: ${a.purpose?.text ?? ""}`,
    `Process: ${(a.applicability.process.value ?? []).join(", ")}`,
    `Roles: ${(a.applicability.roles.value ?? []).join(", ")}`,
    `Objects: ${(a.applicability.business_objects.value ?? []).join(", ")}`,
  ];
  return parts.filter(Boolean).join("\n");
}

export async function groundDomainForChangeSet(
  admin: SupabaseClient<Database>,
  changeSetId: string,
  opts: { batchSize?: number } = {},
): Promise<{ tagged: number; proposed: number; embedded: number; failed: number; remaining: number }> {
  const batchSize = opts.batchSize ?? 2;
  const settings = await loadLlmSettings();
  const prompt = await loadActivePrompt("tag_assignment");

  // Load existing vocabulary
  const { data: vocab } = await admin
    .from("domain_model")
    .select("category, value, label");
  const vocabByCat: Record<string, { value: string; label: string }[]> = {};
  for (const c of CATEGORIES) vocabByCat[c] = [];
  for (const t of vocab ?? []) {
    vocabByCat[t.category].push({ value: t.value, label: t.label });
  }

  const allowedByCat: Record<string, Set<string>> = {};
  for (const c of CATEGORIES) allowedByCat[c] = new Set(vocabByCat[c].map((v) => v.value));

  const { data: items } = await admin
    .from("change_set_items")
    .select("id, atom_payload")
    .eq("change_set_id", changeSetId)
    .is("grounded_at", null)
    .order("id", { ascending: true })
    .limit(batchSize);
  if (!items) return { tagged: 0, proposed: 0, embedded: 0, failed: 0, remaining: 0 };

  let tagged = 0;
  let proposed = 0;
  let embedded = 0;
  let failed = 0;

  for (const item of items) {
    const atom = item.atom_payload as unknown as ProcessAtom;
    if (!atom || !atom.identity) {
      await admin.from("change_set_items").update({ grounded_at: new Date().toISOString() } as never).eq("id", item.id);
      continue;
    }

    const payload = {
      ATOM_NAME: atom.identity.name,
      ATOM_ID: atom.identity.atom_id,
      KNOWLEDGE_TYPE: atom.knowledge_type,
      ACTION: {
        modality: atom.action.modality,
        actor: atom.action.actor,
        operation: atom.action.operation,
        object: atom.action.object,
      },
      PURPOSE: atom.purpose?.text,
      EVIDENCE: atom.provenance?.quoted_evidence?.map((q) => q.text).slice(0, 3),
      EXISTING_VOCABULARY: vocabByCat,
    };

    let assigned: Partial<AtomDomainTags> = {};
    let propList: { category: DomainCategory; value: string; label: string; rationale?: string }[] = [];
    try {
      const res = await chat({
        settings,
        promptKey: "tag_assignment",
        promptVersion: prompt.version,
        json: true,
        messages: [
          { role: "system", content: prompt.template },
          { role: "user", content: JSON.stringify(payload, null, 2) },
        ],
      });
      const parsed = parseJsonLoose<{
        assigned?: Partial<AtomDomainTags>;
        proposed?: { category: DomainCategory; value: string; label: string; rationale?: string }[];
      }>(res.content);
      assigned = parsed.assigned ?? {};
      propList = Array.isArray(parsed.proposed) ? parsed.proposed : [];
    } catch (e) {
      console.error("tag_assignment failed", e);
      failed++;
      continue;
    }

    // Enforce: only tags in the existing vocabulary end up on the atom.
    const finalTags = emptyTags();
    for (const cat of CATEGORIES) {
      const arr = (assigned as Record<string, unknown>)[cat];
      const values = Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
      finalTags[cat] = values.filter((v) => allowedByCat[cat].has(v));
    }

    // Record proposals for new vocabulary (dedup via UNIQUE(category,value))
    for (const p of propList) {
      if (!p || !CATEGORIES.includes(p.category)) continue;
      const value = String(p.value ?? "").trim().toLowerCase();
      if (!value || allowedByCat[p.category].has(value)) continue;
      const { error } = await admin.from("tag_proposals").upsert(
        {
          category: p.category,
          value,
          label: String(p.label ?? value),
          rationale: String(p.rationale ?? ""),
          source_change_set_item: item.id,
          status: "proposed",
        } as never,
        { onConflict: "category,value", ignoreDuplicates: true },
      );
      if (!error) proposed++;
    }

    // Write tags back onto the atom
    const updated: ProcessAtom = { ...atom, domain_tags: finalTags };

    // Compute embedding (best-effort)
    let embVec: number[] | null = null;
    try {
      const { vector } = await embed(settings, serializeAtomForEmbedding(updated));
      embVec = vector;
      embedded++;
    } catch (e) {
      console.warn("embed skipped:", (e as Error).message);
    }

    const updatePayload: Record<string, unknown> = { atom_payload: updated as never };
    if (embVec) updatePayload.atom_embedding = embVec as never;
    updatePayload.grounded_at = new Date().toISOString();

    await admin
      .from("change_set_items")
      .update(updatePayload as never)
      .eq("id", item.id);

    tagged++;
  }

  const { count } = await admin
    .from("change_set_items")
    .select("id", { count: "exact", head: true })
    .eq("change_set_id", changeSetId)
    .is("grounded_at", null);

  return { tagged, proposed, embedded, failed, remaining: count ?? 0 };
}