/**
 * Idempotent demo seed — loads the paper's running example so every feature of
 * AtomForge is demonstrable end-to-end without waiting on an LLM run.
 *
 * Seeds: domain-model vocabulary, two normative POLICY sources with tricky text
 * (implicit rule, heading-scoped section, threshold, exception), four ACTIVE
 * atoms with full provenance / tags / governance / quality, an EXCEPTION_TO
 * relationship, and one enabled precedence strategy.
 *
 * Does NOT trigger the LLM pipeline. Users still run parse + compile on the
 * seeded sources to see the automated path.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ProcessAtom } from "@/types/atom";

export interface DemoSeedOutcome {
  vocabulary_added: number;
  sources_added: number;
  atoms_added: number;
  atoms_updated: number;
  relationships_added: number;
  precedence_enabled: number;
  already_present: boolean;
}

const NOW = () => new Date().toISOString();

const VOCAB: Array<{ category: Database["public"]["Enums"]["domain_category"]; value: string; label: string }> = [
  // corporate functions
  { category: "corporate_function", value: "procurement", label: "Procurement" },
  { category: "corporate_function", value: "finance", label: "Finance" },
  // end-to-end processes
  { category: "end_to_end_process", value: "purchase-to-pay", label: "Purchase-to-Pay" },
  // processes
  { category: "process", value: "purchase-to-pay", label: "Purchase-to-Pay" },
  // activities
  { category: "activity", value: "create-purchase-requisition", label: "Create purchase requisition" },
  { category: "activity", value: "submit-purchase-requisition", label: "Submit purchase requisition" },
  { category: "activity", value: "submit-invoice", label: "Submit invoice" },
  { category: "activity", value: "approve-invoice", label: "Approve invoice" },
  // business objects
  { category: "business_object", value: "purchase_requisition", label: "Purchase Requisition" },
  { category: "business_object", value: "invoice", label: "Invoice" },
  { category: "business_object", value: "cost_center", label: "Cost Center" },
  // roles
  { category: "role", value: "requester", label: "Requester" },
  { category: "role", value: "procurement_assistant", label: "Procurement Assistant" },
  { category: "role", value: "procurement_agent", label: "Procurement Agent" },
  { category: "role", value: "plant_procurement_manager", label: "Plant Procurement Manager" },
  { category: "role", value: "compliance_officer", label: "Compliance Officer" },
  // systems
  { category: "system", value: "erp", label: "ERP System" },
  // org units
  { category: "organizational_unit", value: "hq", label: "Headquarters" },
  { category: "organizational_unit", value: "plant-de-01", label: "Plant DE-01" },
];

const CORPORATE_POLICY_TEXT = `Corporate Procurement Policy v5.2

1. Scope
This policy governs all purchase-to-pay activities across the group.

3. Purchase Requisitions
3.1 Every purchase requisition must specify a valid cost center at submission.
Requests without a cost center are returned to the requester.

5. Invoice Processing
5.1 Invoice price deviations from the referenced purchase order require procurement review.
5.2 If the invoice deviation exceeds EUR 250, procurement approval is required before payment. Deviations at or under EUR 250 may be auto-accepted by the payables agent.

6. Supplier Qualification
6.1 Non-preferred suppliers require three competitive quotations. Preferred suppliers are exempt from the additional quotation requirement.

7.2 Medical Equipment Purchases
All deviations from the standard procurement flow for medical equipment must be reviewed by Compliance.
`;

const FINANCE_POLICY_TEXT = `Finance Control Directive v3.1

4. Cost Center Governance
4.1 Every ledger-affecting document must carry an active, budget-open cost center.
4.2 Cost center owners are accountable for budget adherence.
`;

// Build ScopedValue helpers.
const explicit = (values: string[]): ProcessAtom["applicability"]["process"] => ({
  value: values, status: "explicit", requires_review: false,
});
const notStated: ProcessAtom["applicability"]["process"] = { value: null, status: "not_stated", requires_review: true };

function baseGovernance(): ProcessAtom["governance"] {
  return { owner: "procurement_leadership", required_approvers: ["policy_owner"], authority_level: "executive" };
}
function baseQuality(overrides: Partial<ProcessAtom["quality"]> = {}): ProcessAtom["quality"] {
  return {
    action_confidence: 0.95, applicability_confidence: 0.9, purpose_confidence: 0.85, atomicity_score: 0.95,
    validations: [
      { layer: "schema", passed: true, score: 1, issues: [] },
      { layer: "semantic_completeness", passed: true, score: 1, issues: [] },
      { layer: "atomicity", passed: true, score: 0.95, issues: [] },
      { layer: "groundedness", passed: true, score: 1, issues: [] },
    ],
    ...overrides,
  };
}

function makeProvenance(sourceId: string, page: number, section: string, quote: string, extraHash: string): ProcessAtom["provenance"] {
  return {
    source_id: sourceId, source_type: "POLICY",
    source_title: "Corporate Procurement Policy v5.2", source_version: "5.2",
    page, section, paragraph_id: `${section}-p1`,
    source_text_hash: extraHash,
    quoted_evidence: [{ text: quote, page, section }],
    ingestion_timestamp: NOW(),
    parser_version: "atomforge-parser@1.0.0",
    extractor_version: "atomforge-extractor@1.0.0",
    extraction_model: "demo-seed",
    extraction_prompt_version: "demo-1",
  };
}

function buildAtoms(sourceCorporateId: string, sourceFinanceId: string): ProcessAtom[] {
  const now = NOW();
  const activeVersion = (v = 1): ProcessAtom["version"] => ({
    version: v, status: "active", valid_from: now, valid_to: null, transaction_time: now,
  });

  const costCenter: ProcessAtom = {
    identity: { atom_id: "procurement.pr.cost-center-required", name: "Purchase requisitions must specify a valid cost center" },
    version: activeVersion(),
    knowledge_type: "DATA_REQUIREMENT",
    applicability: {
      process: explicit(["purchase-to-pay"]),
      activities: explicit(["submit-purchase-requisition"]),
      roles: explicit(["requester"]),
      organizational_scope: {
        company_codes: notStated, subsidiaries: notStated, plants: notStated,
      },
      business_objects: explicit(["purchase_requisition"]),
      preconditions: [],
      exceptions: [],
      temporal_scope: { valid_from: null, valid_to: null },
    },
    action: {
      modality: "MUST", actor: "requester", operation: "assign", object: "valid_cost_center",
      target: "purchase_requisition",
      on_noncompliance: [{
        modality: "MUST", actor: "system", operation: "reject",
        object: "purchase_requisition", on_noncompliance: [],
      }],
    },
    purpose: {
      text: "Ensures budgetary accountability and audit traceability for every commitment made against corporate funds.",
      derivation: "explicit", confidence: 0.9, execution_authoritative: false,
    },
    domain_tags: {
      corporate_function: ["procurement", "finance"],
      end_to_end_process: ["purchase-to-pay"],
      process: ["purchase-to-pay"],
      activity: ["submit-purchase-requisition"],
      business_object: ["purchase_requisition", "cost_center"],
      role: ["requester"], system: ["erp"], organizational_unit: [],
    },
    provenance: makeProvenance(sourceCorporateId, 3, "3.1",
      "Every purchase requisition must specify a valid cost center at submission. Requests without a cost center are returned to the requester.",
      "sha256:demo-cc-req"),
    governance: baseGovernance(),
    relationships: [{ type: "DEPENDS_ON", target_atom_id: "finance.cc.active-budget-open", note: "Cost center must be active and budget-open" }],
    quality: baseQuality(),
  };

  const invoiceGeneral: ProcessAtom = {
    identity: { atom_id: "procurement.invoice.price-deviation.general", name: "Invoice price deviations require procurement review" },
    version: activeVersion(),
    knowledge_type: "OBLIGATION",
    applicability: {
      process: explicit(["purchase-to-pay"]),
      activities: explicit(["approve-invoice"]),
      roles: explicit(["procurement_agent"]),
      organizational_scope: { company_codes: notStated, subsidiaries: notStated, plants: notStated },
      business_objects: explicit(["invoice"]),
      preconditions: [{ field: "invoice.deviation_eur", operator: "EXISTS", value: null }],
      exceptions: [],
      temporal_scope: { valid_from: null, valid_to: null },
    },
    action: {
      modality: "MUST", actor: "procurement_agent", operation: "review", object: "invoice",
      on_noncompliance: [],
    },
    purpose: {
      text: "Prevent unapproved cost drift between the referenced purchase order and the invoiced amount.",
      derivation: "explicit", confidence: 0.9, execution_authoritative: false,
    },
    domain_tags: {
      corporate_function: ["procurement"], end_to_end_process: ["purchase-to-pay"],
      process: ["purchase-to-pay"], activity: ["approve-invoice"],
      business_object: ["invoice"], role: ["procurement_agent"], system: ["erp"], organizational_unit: [],
    },
    provenance: makeProvenance(sourceCorporateId, 5, "5.1",
      "Invoice price deviations from the referenced purchase order require procurement review.",
      "sha256:demo-inv-gen"),
    governance: baseGovernance(),
    relationships: [],
    quality: baseQuality(),
  };

  const invoiceAutoAccept: ProcessAtom = {
    identity: { atom_id: "procurement.invoice.auto-accept-under-250", name: "Auto-accept invoice deviations at or under EUR 250" },
    version: activeVersion(),
    knowledge_type: "PERMISSION",
    applicability: {
      process: explicit(["purchase-to-pay"]),
      activities: explicit(["approve-invoice"]),
      roles: explicit(["procurement_agent"]),
      organizational_scope: { company_codes: notStated, subsidiaries: notStated, plants: notStated },
      business_objects: explicit(["invoice"]),
      preconditions: [{ field: "invoice.deviation_eur", operator: "LTE", value: 250 }],
      exceptions: [],
      temporal_scope: { valid_from: null, valid_to: null },
    },
    action: {
      modality: "MAY", actor: "payables_agent", operation: "auto_accept", object: "invoice",
      parameters: { threshold_eur: 250 },
      on_noncompliance: [],
    },
    purpose: {
      text: "Reduce approval friction for immaterial deviations while preserving control on larger ones.",
      derivation: "explicit", confidence: 0.9, execution_authoritative: false,
    },
    domain_tags: invoiceGeneral.domain_tags,
    provenance: makeProvenance(sourceCorporateId, 5, "5.2",
      "Deviations at or under EUR 250 may be auto-accepted by the payables agent.",
      "sha256:demo-inv-auto"),
    governance: baseGovernance(),
    relationships: [{ type: "EXCEPTION_TO", target_atom_id: "procurement.invoice.price-deviation.general", note: "Carves out the ≤ EUR 250 band from the general review obligation." }],
    quality: baseQuality(),
  };

  const medicalCompliance: ProcessAtom = {
    identity: { atom_id: "procurement.medical-equipment.compliance-review", name: "Medical-equipment deviations require Compliance review" },
    version: activeVersion(),
    knowledge_type: "ESCALATION",
    applicability: {
      process: explicit(["purchase-to-pay"]),
      activities: explicit(["approve-invoice", "create-purchase-requisition"]),
      roles: explicit(["compliance_officer"]),
      organizational_scope: { company_codes: notStated, subsidiaries: notStated, plants: notStated },
      business_objects: explicit(["invoice", "purchase_requisition"]),
      preconditions: [{ field: "purchase_requisition.category", operator: "EQUALS", value: "medical_equipment" }],
      exceptions: [],
      temporal_scope: { valid_from: null, valid_to: null },
    },
    action: {
      modality: "MUST", actor: "compliance_officer", operation: "review", object: "deviation",
      target: "medical_equipment_procurement",
      on_noncompliance: [{
        modality: "MUST", actor: "system", operation: "block", object: "purchase_requisition", on_noncompliance: [],
      }],
    },
    purpose: {
      text: "Medical equipment procurement carries regulatory risk; deviations must have explicit compliance sign-off.",
      derivation: "explicit", confidence: 0.9, execution_authoritative: false,
    },
    domain_tags: {
      corporate_function: ["procurement", "finance"], end_to_end_process: ["purchase-to-pay"],
      process: ["purchase-to-pay"], activity: ["approve-invoice", "create-purchase-requisition"],
      business_object: ["invoice", "purchase_requisition"],
      role: ["compliance_officer"], system: ["erp"], organizational_unit: [],
    },
    provenance: makeProvenance(sourceCorporateId, 7, "7.2",
      "All deviations from the standard procurement flow for medical equipment must be reviewed by Compliance.",
      "sha256:demo-med-comp"),
    governance: { ...baseGovernance(), authority_level: "regulatory" },
    relationships: [{ type: "SPECIALIZES", target_atom_id: "procurement.invoice.price-deviation.general", note: "Restricts the general deviation rule to medical equipment with a Compliance actor." }],
    quality: baseQuality(),
  };

  // finance-side dependency target used by cost-center atom
  const financeCC: ProcessAtom = {
    identity: { atom_id: "finance.cc.active-budget-open", name: "Ledger-affecting documents require an active, budget-open cost center" },
    version: activeVersion(),
    knowledge_type: "DATA_REQUIREMENT",
    applicability: {
      process: explicit(["purchase-to-pay"]),
      activities: explicit(["submit-purchase-requisition", "approve-invoice"]),
      roles: explicit(["requester", "procurement_agent"]),
      organizational_scope: { company_codes: notStated, subsidiaries: notStated, plants: notStated },
      business_objects: explicit(["purchase_requisition", "invoice", "cost_center"]),
      preconditions: [],
      exceptions: [],
      temporal_scope: { valid_from: null, valid_to: null },
    },
    action: {
      modality: "MUST", actor: "system", operation: "validate", object: "cost_center",
      parameters: { must_be: ["active", "budget_open"] },
      on_noncompliance: [{ modality: "MUST", actor: "system", operation: "reject", object: "document", on_noncompliance: [] }],
    },
    purpose: {
      text: "Budget integrity depends on charging only against live, open budgets.",
      derivation: "explicit", confidence: 0.9, execution_authoritative: false,
    },
    domain_tags: {
      corporate_function: ["finance"], end_to_end_process: ["purchase-to-pay"],
      process: ["purchase-to-pay"], activity: ["submit-purchase-requisition", "approve-invoice"],
      business_object: ["cost_center", "purchase_requisition", "invoice"],
      role: ["requester", "procurement_agent"], system: ["erp"], organizational_unit: [],
    },
    provenance: {
      source_id: sourceFinanceId, source_type: "POLICY",
      source_title: "Finance Control Directive v3.1", source_version: "3.1",
      page: 4, section: "4.1", paragraph_id: "4.1-p1",
      source_text_hash: "sha256:demo-fin-cc",
      quoted_evidence: [{ text: "Every ledger-affecting document must carry an active, budget-open cost center.", page: 4, section: "4.1" }],
      ingestion_timestamp: NOW(),
      parser_version: "atomforge-parser@1.0.0",
      extractor_version: "atomforge-extractor@1.0.0",
      extraction_model: "demo-seed",
      extraction_prompt_version: "demo-1",
    },
    governance: { owner: "finance_leadership", required_approvers: ["policy_owner"], authority_level: "executive" },
    relationships: [],
    quality: baseQuality(),
  };

  return [costCenter, invoiceGeneral, invoiceAutoAccept, medicalCompliance, financeCC];
}

function toRow(atom: ProcessAtom, sourceId: string) {
  return {
    atom_id: atom.identity.atom_id, name: atom.identity.name,
    version: atom.version.version, status: atom.version.status,
    transaction_time: atom.version.transaction_time,
    valid_from: atom.version.valid_from, valid_to: atom.version.valid_to,
    knowledge_type: atom.knowledge_type,
    applicability: atom.applicability as never,
    action: atom.action as never,
    purpose: atom.purpose as never,
    domain_tags: atom.domain_tags as never,
    provenance: atom.provenance as never,
    governance: atom.governance as never,
    quality: atom.quality as never,
    processes: atom.applicability.process.value ?? [],
    activities: atom.applicability.activities.value ?? [],
    roles: atom.applicability.roles.value ?? [],
    business_objects: atom.applicability.business_objects.value ?? [],
    source_id: sourceId,
  };
}

export async function seedDemoScenario(
  admin: SupabaseClient<Database>,
  actorId: string,
): Promise<DemoSeedOutcome> {
  const outcome: DemoSeedOutcome = {
    vocabulary_added: 0, sources_added: 0, atoms_added: 0, atoms_updated: 0,
    relationships_added: 0, precedence_enabled: 0, already_present: false,
  };

  // Vocabulary — idempotent unique(category, value) insert.
  for (const v of VOCAB) {
    const { data: existing } = await admin
      .from("domain_model").select("id").eq("category", v.category).eq("value", v.value).maybeSingle();
    if (!existing) {
      const { error } = await admin.from("domain_model").insert(v as never);
      if (!error) outcome.vocabulary_added++;
    }
  }

  // Sources — idempotent on (title, version).
  async function ensureSource(input: {
    source_id: string; title: string; version: string; raw_text: string;
  }): Promise<string> {
    const { data: existing } = await admin
      .from("sources").select("id").eq("source_id", input.source_id).maybeSingle();
    if (existing) return existing.id;
    const { data, error } = await admin.from("sources").insert({
      source_id: input.source_id, title: input.title,
      source_type: "POLICY", authority_class: "NORMATIVE",
      version: input.version, owner: "policy_owner",
      approval_status: "approved", raw_text: input.raw_text,
      file_sha256: `demo:${input.source_id}`, status: "extracted",
      ingestion_timestamp: NOW(), created_by: actorId,
    } as never).select("id").single();
    if (error || !data) throw error ?? new Error("insert source failed");
    outcome.sources_added++;
    return data.id;
  }

  const corporateId = await ensureSource({
    source_id: "demo-corp-procurement-policy-v5.2",
    title: "Corporate Procurement Policy v5.2", version: "5.2",
    raw_text: CORPORATE_POLICY_TEXT,
  });
  const financeId = await ensureSource({
    source_id: "demo-finance-control-directive-v3.1",
    title: "Finance Control Directive v3.1", version: "3.1",
    raw_text: FINANCE_POLICY_TEXT,
  });

  // Atoms — idempotent on (atom_id, version). Skip if already present.
  const atoms = buildAtoms(corporateId, financeId);
  const atomIdToUuid = new Map<string, string>();
  for (const atom of atoms) {
    const sourceId = atom.identity.atom_id.startsWith("finance.") ? financeId : corporateId;
    const { data: existing } = await admin
      .from("atoms").select("id").eq("atom_id", atom.identity.atom_id).eq("version", atom.version.version).maybeSingle();
    if (existing) {
      atomIdToUuid.set(atom.identity.atom_id, existing.id);
      continue;
    }
    const { data, error } = await admin.from("atoms").insert(toRow(atom, sourceId) as never).select("id").single();
    if (error || !data) throw error ?? new Error(`insert atom ${atom.identity.atom_id} failed`);
    atomIdToUuid.set(atom.identity.atom_id, data.id);
    outcome.atoms_added++;
  }

  // Relationships from atom.relationships[] → atom_relationships table.
  for (const atom of atoms) {
    const fromUuid = atomIdToUuid.get(atom.identity.atom_id);
    if (!fromUuid) continue;
    for (const rel of atom.relationships) {
      const { data: existing } = await admin
        .from("atom_relationships").select("id")
        .eq("from_atom", fromUuid).eq("to_atom_id", rel.target_atom_id).eq("relationship_type", rel.type).maybeSingle();
      if (existing) continue;
      const { error } = await admin.from("atom_relationships").insert({
        from_atom: fromUuid, to_atom_id: rel.target_atom_id,
        relationship_type: rel.type, rationale: rel.note ?? null, created_by: actorId,
      } as never);
      if (!error) outcome.relationships_added++;
    }
  }

  // Precedence strategy — enable more_specific_rule_overrides_general_rule.
  const { data: strat } = await admin
    .from("precedence_strategies").select("id, enabled")
    .eq("name", "more_specific_rule_overrides_general_rule").maybeSingle();
  if (!strat) {
    const { error } = await admin.from("precedence_strategies").insert({
      name: "more_specific_rule_overrides_general_rule",
      description: "When two atoms conflict, prefer the atom with the more specific applicability scope (more explicit dimensions).",
      priority_order: ["specificity"] as never, enabled: true,
    } as never);
    if (!error) outcome.precedence_enabled++;
  } else if (!strat.enabled) {
    await admin.from("precedence_strategies").update({ enabled: true } as never).eq("id", strat.id);
    outcome.precedence_enabled++;
  }

  outcome.already_present =
    outcome.sources_added === 0 && outcome.atoms_added === 0 &&
    outcome.relationships_added === 0 && outcome.vocabulary_added === 0;

  return outcome;
}