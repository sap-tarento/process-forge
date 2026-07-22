/**
 * Generate 2–4 concrete runtime scenario sentences for a single atom.
 * Used by the Review workspace so a human reviewer can sanity-check behavior.
 */
import type { ProcessAtom } from "@/types/atom";
import { chat, parseJsonLoose } from "./llm-gateway.server";
import { loadLlmSettings, loadActivePrompt } from "./settings.server";

export interface Scenario { situation: string; expected: string }

export async function generateScenarios(atom: ProcessAtom): Promise<Scenario[]> {
  const settings = await loadLlmSettings();
  const prompt = await loadActivePrompt("scenarios");
  const payload = {
    atom_id: atom.identity.atom_id,
    name: atom.identity.name,
    knowledge_type: atom.knowledge_type,
    applicability: atom.applicability,
    action: atom.action,
    purpose: atom.purpose?.text,
    evidence: atom.provenance?.quoted_evidence?.map((q) => q.text).slice(0, 4),
  };
  const res = await chat({
    settings,
    promptKey: "scenarios",
    promptVersion: prompt.version,
    json: true,
    messages: [
      { role: "system", content: prompt.template },
      { role: "user", content: JSON.stringify(payload, null, 2) },
    ],
  });
  const parsed = parseJsonLoose<{ scenarios?: Scenario[] }>(res.content);
  const arr = Array.isArray(parsed?.scenarios) ? parsed!.scenarios! : [];
  return arr
    .filter((s) => s && typeof s.situation === "string" && typeof s.expected === "string")
    .slice(0, 4);
}
