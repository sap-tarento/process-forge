/**
 * Post-processing enforcement of the paper's contract on any candidate atom
 * regardless of what the model returned.
 */
import type {
  ProcessAtom,
  ScopedValue,
  AtomApplicability,
  KnowledgeType,
} from "@/types/atom";

const KNOWLEDGE_TYPES = new Set<KnowledgeType>([
  "OBLIGATION",
  "PROHIBITION",
  "PERMISSION",
  "RESPONSIBILITY",
  "DECISION_RULE",
  "DATA_REQUIREMENT",
  "ESCALATION",
  "SEQUENCE",
  "TEMPORAL_RULE",
  "EXCEPTION",
]);

const WILDCARDS = ["*", "all", "any", "everyone", "everywhere"];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s._-]+/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function titleCase(s: string): string {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function modalityVerb(m: "MUST" | "MUST_NOT" | "MAY" | null): string {
  if (m === "MUST_NOT") return "must not";
  if (m === "MAY") return "may";
  return "must";
}

function shortHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36).slice(0, 8);
}

function deriveName(
  action: { modality: "MUST" | "MUST_NOT" | "MAY" | null; actor: string; operation: string; object: string },
  quotedEvidence: unknown[],
): string {
  const parts = [action.actor, modalityVerb(action.modality), action.operation, action.object]
    .map((p) => (p ?? "").toString().trim())
    .filter((p) => p.length > 0);
  if (parts.length >= 3) {
    return titleCase(parts.join(" ")).slice(0, 140);
  }
  const firstQuote = quotedEvidence.find((q) => q && typeof q === "object" && typeof (q as { text?: unknown }).text === "string") as
    | { text: string }
    | undefined;
  if (firstQuote) {
    const words = firstQuote.text.trim().split(/\s+/).slice(0, 8).join(" ");
    if (words.length > 0) return words;
  }
  return "Candidate atom (unnamed by extractor)";
}

function deriveAtomId(
  domainTags: Record<string, unknown>,
  action: { operation: string; object: string; actor: string },
  fallbackSeed: string,
): string {
  const firstOf = (key: string): string | null => {
    const arr = domainTags[key];
    if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === "string") return arr[0];
    return null;
  };
  const domain =
    firstOf("corporate_function") ??
    firstOf("process") ??
    firstOf("end_to_end_process") ??
    firstOf("business_object") ??
    "unclassified";
  const object = action.object || firstOf("business_object") || action.actor || "rule";
  const op = action.operation || "rule";
  const parts = [slugify(domain), slugify(object), slugify(op)].filter((p) => p.length > 0);
  if (parts.length >= 2) return parts.join(".");
  return `unclassified.${shortHash(fallbackSeed).slice(0, 6)}.rule`;
}

function coerceScopedValue(raw: unknown): ScopedValue {
  if (!raw || typeof raw !== "object") {
    return { value: null, status: "not_stated", requires_review: true };
  }
  const r = raw as Record<string, unknown>;
  let value: string[] | null = null;
  if (Array.isArray(r.value)) value = r.value.filter((v) => typeof v === "string") as string[];
  else if (typeof r.value === "string" && r.value.trim() !== "") value = [r.value];

  let status = (typeof r.status === "string" ? r.status : "not_stated") as ScopedValue["status"];

  // SAFEGUARD: strip wildcard tokens and downgrade to not_stated if derivation isn't explicit
  const evidence = (r.evidence as Record<string, unknown> | undefined) ?? {};
  const derivation = typeof evidence.derivation === "string" ? evidence.derivation : "unknown";

  if (value) {
    const cleaned = value.filter((v) => !WILDCARDS.includes(v.trim().toLowerCase()));
    if (cleaned.length === 0) value = null;
    else value = cleaned;
  }

  if (!value) {
    status = "not_stated";
  } else if (derivation !== "explicit" && status === "explicit") {
    status = "inferred";
  }

  return {
    value,
    status,
    requires_review: status === "not_stated" || status === "inferred",
    evidence: {
      derivation: (["explicit", "inherited", "inferred", "unknown"].includes(derivation)
        ? derivation
        : "unknown") as ScopedValue["evidence"] extends infer E ? E extends { derivation: infer D } ? D : never : never,
      source_page: typeof evidence.source_page === "number" ? evidence.source_page : undefined,
      source_section: typeof evidence.source_section === "string" ? evidence.source_section : undefined,
      source_span: typeof evidence.source_span === "string" ? evidence.source_span : undefined,
    },
  };
}

function coerceApplicability(raw: unknown): AtomApplicability {
  const r = (raw ?? {}) as Record<string, unknown>;
  const os = (r.organizational_scope ?? {}) as Record<string, unknown>;
  const temporal = (r.temporal_scope ?? {}) as Record<string, unknown>;
  return {
    process: coerceScopedValue(r.process),
    activities: coerceScopedValue(r.activities),
    roles: coerceScopedValue(r.roles),
    organizational_scope: {
      company_codes: coerceScopedValue(os.company_codes),
      subsidiaries: coerceScopedValue(os.subsidiaries),
      plants: coerceScopedValue(os.plants),
    },
    business_objects: coerceScopedValue(r.business_objects),
    preconditions: Array.isArray(r.preconditions) ? (r.preconditions as never[]) : [],
    exceptions: Array.isArray(r.exceptions) ? (r.exceptions as never[]) : [],
    temporal_scope: {
      valid_from: typeof temporal.valid_from === "string" ? temporal.valid_from : null,
      valid_to: typeof temporal.valid_to === "string" ? temporal.valid_to : null,
    },
  };
}

export interface ValidationOutcome {
  atom: ProcessAtom;
  passed: boolean;
  issues: string[];
}

/**
 * Normalize a raw model-produced atom and validate it against the paper's contract.
 * Returns a fully-typed ProcessAtom (candidate status, purpose.execution_authoritative=false)
 * and a list of blocking issues.
 */
export function coerceAndValidate(raw: unknown, meta: {
  source_title: string;
  source_type: ProcessAtom["provenance"]["source_type"];
  source_id: string;
  source_version: string;
  source_text_hash: string;
  extraction_model: string;
  extraction_prompt_version: string;
  parser_version: string;
  extractor_version: string;
  page?: number;
  section?: string;
  isDescriptive: boolean;
}): ValidationOutcome {
  const issues: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;
  const identity = (r.identity ?? {}) as Record<string, unknown>;
  const purpose = (r.purpose ?? {}) as Record<string, unknown>;
  const governance = (r.governance ?? {}) as Record<string, unknown>;
  const action = (r.action ?? {}) as Record<string, unknown>;
  const quality = (r.quality ?? {}) as Record<string, unknown>;
  const provenance = (r.provenance ?? {}) as Record<string, unknown>;
  const domainTags = (r.domain_tags ?? {}) as Record<string, unknown>;

  const knowledgeType = typeof r.knowledge_type === "string" && KNOWLEDGE_TYPES.has(r.knowledge_type as KnowledgeType)
    ? (r.knowledge_type as KnowledgeType)
    : null;
  if (!knowledgeType) issues.push("Missing or invalid knowledge_type");

  const atomId = typeof identity.atom_id === "string" && /^[a-z0-9._-]+$/i.test(identity.atom_id)
    ? String(identity.atom_id).toLowerCase()
    : null;
  if (!atomId) issues.push("Missing or invalid identity.atom_id (must be dotted lowercase slug)");

  const name = typeof identity.name === "string" && identity.name.trim().length > 0
    ? identity.name.trim()
    : null;
  if (!name) issues.push("Missing identity.name");

  const modality = ["MUST", "MUST_NOT", "MAY"].includes(String(action.modality))
    ? (action.modality as "MUST" | "MUST_NOT" | "MAY")
    : null;
  if (!modality) issues.push("Missing or invalid action.modality");

  const actor = typeof action.actor === "string" ? action.actor : "";
  const operation = typeof action.operation === "string" ? action.operation : "";
  const object = typeof action.object === "string" ? action.object : "";
  if (!actor) issues.push("Missing action.actor");
  if (!operation) issues.push("Missing action.operation");
  if (!object) issues.push("Missing action.object");

  const applicability = coerceApplicability(r.applicability);

  // Check groundedness: at least one applicability dimension must not be not_stated
  const scoped: ScopedValue[] = [
    applicability.process,
    applicability.activities,
    applicability.roles,
    applicability.business_objects,
  ];
  const anyGrounded = scoped.some((s) => s.status !== "not_stated" && s.value !== null);
  if (!anyGrounded) issues.push("Groundedness: no applicability dimension has an evidence-backed value");

  const quotedEvidence = Array.isArray(provenance.quoted_evidence)
    ? (provenance.quoted_evidence as unknown[]).filter((q) => q && typeof q === "object")
    : [];

  const atom: ProcessAtom = {
    identity: {
      atom_id:
        atomId ??
        deriveAtomId(
          domainTags,
          { operation, object, actor },
          `${meta.source_id}:${meta.page ?? ""}:${meta.section ?? ""}:${operation}:${object}`,
        ),
      name:
        name ??
        deriveName(
          { modality, actor, operation, object },
          quotedEvidence,
        ),
    },
    version: {
      version: 1,
      status: "candidate",
      valid_from: null,
      valid_to: null,
      transaction_time: new Date().toISOString(),
    },
    knowledge_type: knowledgeType ?? "OBLIGATION",
    applicability,
    action: {
      modality: modality ?? "MUST",
      actor: actor || "unspecified",
      operation: operation || "unspecified",
      object: object || "unspecified",
      target: typeof action.target === "string" ? action.target : undefined,
      parameters: action.parameters && typeof action.parameters === "object" ? action.parameters as Record<string, unknown> : undefined,
      deadline: typeof action.deadline === "string" ? action.deadline : undefined,
      timing: typeof action.timing === "string" ? action.timing : undefined,
      on_noncompliance: Array.isArray(action.on_noncompliance) ? action.on_noncompliance as never[] : [],
    },
    purpose: {
      text: typeof purpose.text === "string" ? purpose.text : "",
      derivation: (["explicit", "inferred", "unknown"].includes(String(purpose.derivation))
        ? purpose.derivation
        : "unknown") as "explicit" | "inferred" | "unknown",
      confidence: typeof purpose.confidence === "number" ? Math.max(0, Math.min(1, purpose.confidence)) : 0.5,
      execution_authoritative: false, // enforced
    },
    domain_tags: {
      corporate_function: Array.isArray(domainTags.corporate_function) ? domainTags.corporate_function as string[] : [],
      end_to_end_process: Array.isArray(domainTags.end_to_end_process) ? domainTags.end_to_end_process as string[] : [],
      process: Array.isArray(domainTags.process) ? domainTags.process as string[] : [],
      activity: Array.isArray(domainTags.activity) ? domainTags.activity as string[] : [],
      business_object: Array.isArray(domainTags.business_object) ? domainTags.business_object as string[] : [],
      role: Array.isArray(domainTags.role) ? domainTags.role as string[] : [],
      system: Array.isArray(domainTags.system) ? domainTags.system as string[] : [],
      organizational_unit: Array.isArray(domainTags.organizational_unit) ? domainTags.organizational_unit as string[] : [],
    },
    provenance: {
      source_id: meta.source_id,
      source_type: meta.source_type,
      source_title: meta.source_title,
      source_version: meta.source_version,
      page: typeof provenance.page === "number" ? provenance.page : meta.page,
      section: typeof provenance.section === "string" ? provenance.section : meta.section,
      paragraph_id: typeof provenance.paragraph_id === "string" ? provenance.paragraph_id : undefined,
      character_start: typeof provenance.character_start === "number" ? provenance.character_start : undefined,
      character_end: typeof provenance.character_end === "number" ? provenance.character_end : undefined,
      source_text_hash: meta.source_text_hash,
      quoted_evidence: quotedEvidence as never,
      ingestion_timestamp: new Date().toISOString(),
      parser_version: meta.parser_version,
      extractor_version: meta.extractor_version,
      extraction_model: meta.extraction_model,
      extraction_prompt_version: meta.extraction_prompt_version,
    },
    governance: {
      owner: typeof governance.owner === "string" ? governance.owner : "unassigned",
      required_approvers: Array.isArray(governance.required_approvers) ? governance.required_approvers as string[] : [],
      authority_level: (["regulatory", "board", "executive", "functional", "local"].includes(String(governance.authority_level))
        ? governance.authority_level
        : "functional") as "regulatory" | "board" | "executive" | "functional" | "local",
    },
    relationships: [],
    quality: {
      action_confidence: typeof quality.action_confidence === "number" ? quality.action_confidence : 0.5,
      applicability_confidence: typeof quality.applicability_confidence === "number" ? quality.applicability_confidence : 0.5,
      purpose_confidence: typeof quality.purpose_confidence === "number" ? quality.purpose_confidence : 0.5,
      atomicity_score: typeof quality.atomicity_score === "number" ? quality.atomicity_score : 0.5,
      validations: [
        { layer: "schema", passed: issues.length === 0, issues: [...issues] },
        { layer: "semantic_completeness", passed: !!(actor && operation && object), issues: [] },
        { layer: "atomicity", passed: true, issues: [] },
        { layer: "groundedness", passed: anyGrounded, issues: anyGrounded ? [] : ["No grounded applicability dimension"] },
      ],
      candidate_observed_practice: meta.isDescriptive || undefined,
    },
  };

  const blocking = issues.length > 0 || !anyGrounded;
  return { atom, passed: !blocking, issues };
}
