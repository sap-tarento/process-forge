CREATE TABLE public.tag_proposals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category public.domain_category NOT NULL,
  value TEXT NOT NULL,
  label TEXT NOT NULL,
  rationale TEXT,
  source_change_set_item UUID REFERENCES public.change_set_items(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','rejected')),
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (category, value)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tag_proposals TO authenticated;
GRANT ALL ON public.tag_proposals TO service_role;
ALTER TABLE public.tag_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in read tag_proposals" ON public.tag_proposals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Curators+ manage tag_proposals" ON public.tag_proposals FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner','curator']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner','curator']::public.app_role[]));
CREATE TRIGGER trg_tag_proposals_updated BEFORE UPDATE ON public.tag_proposals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.prompt_versions (prompt_key, version, template, active) VALUES
('tag_assignment', 1,
$$You are the Enterprise Domain Grounding step of the AtomForge pipeline (Tarento Labs paper, Stage 7).

Assign categorized domain tags to a single candidate atom, using the provided vocabulary.

Rules:
- Use ONLY tags whose `value` appears in EXISTING_VOCABULARY when populating `assigned`.
- If the atom clearly requires a tag that is NOT in the vocabulary, add it to `proposed` with a short `rationale`. Do NOT invent tags to inflate coverage; only propose when the atom text plainly evidences that concept.
- Categories are exactly: corporate_function, end_to_end_process, process, activity, business_object, role, system, organizational_unit.
- Values must be short, lower_snake_case, stable identifiers (e.g. "procurement", "purchase_order", "buyer").
- Never assign a tag that has no support in the atom text.

Return strict JSON:
{
  "assigned": {
    "corporate_function": ["..."], "end_to_end_process": [], "process": [],
    "activity": [], "business_object": [], "role": [], "system": [], "organizational_unit": []
  },
  "proposed": [
    { "category": "process", "value": "vendor_onboarding", "label": "Vendor onboarding", "rationale": "Atom governs the onboarding step explicitly." }
  ]
}$$, true),
('semantic_completeness', 1,
$$You are the Semantic Completeness validator for AtomForge (Stage 9, layer 2).

Given a candidate process atom and its source excerpt, answer this checklist. Each answer is either "yes", "no", or "partial", with a short reason.

Checklist:
1. WHO_MUST_ACT — Is the actor / responsible party clearly identifiable?
2. WHAT_MUST_BE_DONE — Is the required operation (or prohibition) precise enough to execute?
3. WHICH_OBJECT — Is the business object the action applies to identified?
4. UNDER_WHAT_CONDITIONS — Are preconditions / applicability scope stated (not silently universal)?
5. WHEN — Are timing / deadlines captured when the source states them?
6. ON_FAILURE — Are consequences of non-compliance captured when the source states them?
7. EXCEPTIONS_CAPTURED — Are exceptions to the rule captured when the source states them?

Return strict JSON:
{
  "answers": [
    { "id": "WHO_MUST_ACT", "answer": "yes|no|partial", "reason": "..." },
    ... one per checklist item ...
  ]
}$$, true)
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS atoms_status_idx ON public.atoms(status);
CREATE INDEX IF NOT EXISTS atoms_knowledge_type_idx ON public.atoms(knowledge_type);
CREATE INDEX IF NOT EXISTS atoms_atom_id_idx ON public.atoms(atom_id);
CREATE INDEX IF NOT EXISTS atoms_processes_gin ON public.atoms USING GIN (processes);
CREATE INDEX IF NOT EXISTS atoms_roles_gin ON public.atoms USING GIN (roles);
CREATE INDEX IF NOT EXISTS atoms_business_objects_gin ON public.atoms USING GIN (business_objects);