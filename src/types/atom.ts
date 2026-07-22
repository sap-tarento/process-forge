/**
 * AtomForge — Process Atom domain model.
 *
 * Based on: Tarento Labs, "Process Atoms as Compiled Units of Organizational Policy".
 *
 * Invariants:
 *  - Applicability, action, and purpose are strictly separated.
 *  - Every scope dimension is a ScopedValue with explicit epistemic status.
 *    A `not_stated` scope MUST NEVER be widened to a wildcard ("*").
 *  - Purpose is descriptive (execution_authoritative: false), never operational.
 *  - Enforcement consequences (on_noncompliance) belong to the same atom.
 */

export type ISODateTime = string;

export type ScopeStatus = "explicit" | "inherited" | "inferred" | "not_stated";
export type DerivationStatus = "explicit" | "inherited" | "inferred" | "unknown";

export interface FieldEvidence {
  source_page?: number;
  source_section?: string;
  source_span?: string;
  derivation: DerivationStatus;
}

export interface ScopedValue {
  value: string[] | null;
  status: ScopeStatus;
  requires_review: boolean;
  evidence?: FieldEvidence;
}

// 1. Identity
export interface AtomIdentity {
  atom_id: string; // e.g. "procurement.pr.cost-center-required"
  name: string;
}

// 2. Version (bitemporal)
export type AtomStatus =
  | "candidate"
  | "under_review"
  | "approved"
  | "active"
  | "superseded"
  | "withdrawn";

export interface AtomVersion {
  version: number;
  status: AtomStatus;
  valid_from: ISODateTime | null;
  valid_to: ISODateTime | null;
  transaction_time: ISODateTime;
}

// 3. Knowledge type
export type KnowledgeType =
  | "OBLIGATION"
  | "PROHIBITION"
  | "PERMISSION"
  | "RESPONSIBILITY"
  | "DECISION_RULE"
  | "DATA_REQUIREMENT"
  | "ESCALATION"
  | "SEQUENCE"
  | "TEMPORAL_RULE"
  | "EXCEPTION";

// 4. Applicability
export type PreconditionOperator =
  | "EQUALS"
  | "IN"
  | "NOT_IN"
  | "GT"
  | "GTE"
  | "LT"
  | "LTE"
  | "EXISTS";

export interface Precondition {
  field: string;
  operator: PreconditionOperator;
  value: string | number | boolean | string[] | null;
}

export interface OrganizationalScope {
  company_codes: ScopedValue;
  subsidiaries: ScopedValue;
  plants: ScopedValue;
}

export interface TemporalScope {
  valid_from: ISODateTime | null;
  valid_to: ISODateTime | null;
}

export interface AtomApplicability {
  process: ScopedValue;
  activities: ScopedValue;
  roles: ScopedValue;
  organizational_scope: OrganizationalScope;
  business_objects: ScopedValue;
  preconditions: Precondition[];
  exceptions: Precondition[];
  temporal_scope: TemporalScope;
}

// 5. Action
export type ActionModality = "MUST" | "MUST_NOT" | "MAY";

export interface AtomAction {
  modality: ActionModality;
  actor: string;
  operation: string;
  object: string;
  target?: string;
  parameters?: Record<string, unknown>;
  deadline?: string;
  timing?: string;
  on_noncompliance: AtomAction[];
}

// 6. Purpose
export interface AtomPurpose {
  text: string;
  derivation: "explicit" | "inferred" | "unknown";
  confidence: number;
  execution_authoritative: false;
}

// 7. Domain tags
export interface AtomDomainTags {
  corporate_function: string[];
  end_to_end_process: string[];
  process: string[];
  activity: string[];
  business_object: string[];
  role: string[];
  system: string[];
  organizational_unit: string[];
}

// 8. Provenance
export type SourceType =
  | "policy"
  | "sop"
  | "regulation"
  | "contract"
  | "training"
  | "email"
  | "other";

export interface QuotedEvidence {
  text: string;
  page?: number;
  section?: string;
  character_start?: number;
  character_end?: number;
}

export interface AtomProvenance {
  source_id: string;
  source_type: SourceType;
  source_title: string;
  source_version: string;
  page?: number;
  section?: string;
  paragraph_id?: string;
  character_start?: number;
  character_end?: number;
  source_text_hash: string;
  quoted_evidence: QuotedEvidence[];
  ingestion_timestamp: ISODateTime;
  parser_version: string;
  extractor_version: string;
  extraction_model: string;
  extraction_prompt_version: string;
}

// 9. Governance
export type AuthorityLevel =
  | "regulatory"
  | "board"
  | "executive"
  | "functional"
  | "local";

export interface AtomGovernance {
  owner: string;
  required_approvers: string[];
  authority_level: AuthorityLevel;
}

// 10. Relationships
export type RelationshipType =
  | "DUPLICATES"
  | "OVERLAPS"
  | "CONFLICTS_WITH"
  | "SPECIALIZES"
  | "GENERALIZES"
  | "SUPERSEDES"
  | "DEPENDS_ON"
  | "EXCEPTION_TO"
  | "DERIVED_FROM"
  | "IMPLEMENTS";

export interface AtomRelationship {
  type: RelationshipType;
  target_atom_id: string;
  note?: string;
}

// 11. Quality
export type ValidationLayer =
  | "atomicity"
  | "grounding"
  | "scope_safety"
  | "action_completeness"
  | "conflict"
  | "governance";

export interface ValidationResult {
  layer: ValidationLayer;
  passed: boolean;
  score?: number;
  issues: string[];
}

export interface AtomQuality {
  action_confidence: number;
  applicability_confidence: number;
  purpose_confidence: number;
  atomicity_score: number;
  validations: ValidationResult[];
}

// The Atom
export interface ProcessAtom {
  identity: AtomIdentity;
  version: AtomVersion;
  knowledge_type: KnowledgeType;
  applicability: AtomApplicability;
  action: AtomAction;
  purpose: AtomPurpose;
  domain_tags: AtomDomainTags;
  provenance: AtomProvenance;
  governance: AtomGovernance;
  relationships: AtomRelationship[];
  quality: AtomQuality;
}

// 14-stage compilation pipeline
export const PIPELINE_STAGES = [
  "ingest",
  "parse",
  "segment",
  "classify",
  "extract_candidates",
  "resolve_scope",
  "resolve_action",
  "resolve_purpose",
  "tag_domain",
  "ground_evidence",
  "detect_conflicts",
  "score_quality",
  "assemble_change_set",
  "queue_for_review",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];
