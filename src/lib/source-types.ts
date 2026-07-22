import type { Database } from "@/integrations/supabase/types";

export type SourceType = Database["public"]["Enums"]["source_type"];
export type AuthorityClass = Database["public"]["Enums"]["authority_class"];
export type SourceStatus = Database["public"]["Enums"]["source_status"];

export const SOURCE_TYPES: { value: SourceType; label: string; suggests: AuthorityClass }[] = [
  { value: "POLICY", label: "Policy", suggests: "NORMATIVE" },
  { value: "SOP", label: "Standard Operating Procedure", suggests: "NORMATIVE" },
  { value: "REGULATION", label: "Regulation", suggests: "NORMATIVE" },
  { value: "EXPERT_INPUT", label: "Expert input", suggests: "NORMATIVE" },
  { value: "BPMN_MODEL", label: "BPMN model", suggests: "DESCRIPTIVE" },
  { value: "ERP_CONFIG", label: "ERP configuration", suggests: "DESCRIPTIVE" },
  { value: "EVENT_LOG", label: "Event log", suggests: "DESCRIPTIVE" },
  { value: "AGENT_TRACE", label: "Agent trace", suggests: "DESCRIPTIVE" },
];

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = Object.fromEntries(
  SOURCE_TYPES.map((s) => [s.value, s.label]),
) as Record<SourceType, string>;

export function suggestAuthority(t: SourceType): AuthorityClass {
  return SOURCE_TYPES.find((s) => s.value === t)?.suggests ?? "NORMATIVE";
}

export const STATUS_LABEL: Record<SourceStatus, string> = {
  registered: "Registered",
  parsed: "Parsed",
  extracting: "Extracting",
  extracted: "Extracted",
  failed: "Failed",
};
