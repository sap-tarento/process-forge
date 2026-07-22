
CREATE TABLE public.pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.sources(id) ON DELETE CASCADE,
  change_set_id uuid REFERENCES public.change_sets(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','cancelled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  triggered_by uuid,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pipeline_runs_source_idx ON public.pipeline_runs(source_id, started_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.pipeline_runs TO authenticated;
GRANT ALL ON public.pipeline_runs TO service_role;
ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_pipeline_runs_authenticated" ON public.pipeline_runs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "write_pipeline_runs_curators" ON public.pipeline_runs
  FOR ALL TO authenticated
  USING (public.has_any_role(_roles => ARRAY['admin','curator','policy_owner']::app_role[], _user_id => auth.uid()))
  WITH CHECK (public.has_any_role(_roles => ARRAY['admin','curator','policy_owner']::app_role[], _user_id => auth.uid()));

CREATE TABLE public.pipeline_run_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.pipeline_runs(id) ON DELETE CASCADE,
  stage text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','skipped','not_implemented')),
  started_at timestamptz,
  finished_at timestamptz,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  UNIQUE(run_id, stage)
);
CREATE INDEX pipeline_run_stages_run_idx ON public.pipeline_run_stages(run_id);
GRANT SELECT, INSERT, UPDATE ON public.pipeline_run_stages TO authenticated;
GRANT ALL ON public.pipeline_run_stages TO service_role;
ALTER TABLE public.pipeline_run_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_pipeline_run_stages_authenticated" ON public.pipeline_run_stages
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "write_pipeline_run_stages_curators" ON public.pipeline_run_stages
  FOR ALL TO authenticated
  USING (public.has_any_role(_roles => ARRAY['admin','curator','policy_owner']::app_role[], _user_id => auth.uid()))
  WITH CHECK (public.has_any_role(_roles => ARRAY['admin','curator','policy_owner']::app_role[], _user_id => auth.uid()));

ALTER TABLE public.candidate_spans ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES public.sources(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS candidate_spans_source_idx ON public.candidate_spans(source_id);

ALTER TABLE public.atoms ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES public.sources(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS atoms_source_idx ON public.atoms(source_id);

INSERT INTO public.llm_settings (provider, model, embedding_provider, embedding_model, singleton)
VALUES ('lovable', 'google/gemini-2.5-flash', 'lovable', 'google/text-embedding-004', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.prompt_versions (prompt_key, version, template, active) VALUES
('span_detection', 1,
'You are an analyst identifying spans in an organizational document that encode BEHAVIORAL RULES.

You receive one CONTEXT WINDOW (a paragraph plus its surrounding paragraphs and heading path).
Return every span inside the LOCAL_TEXT that expresses:
- an obligation, prohibition, permission
- a conditional requirement (if X then Y)
- an exception ("except when...", "unless...")
- a responsibility assignment ("The controller shall...", "X is responsible for Y")
- an IMPLICIT requirement without modal verbs (e.g. "Requests without a cost center are returned to the requester" implies MUST include a cost center)

Ignore purely explanatory sentences and worked examples.

For each span, output:
{
  "span_text": "<verbatim quote from LOCAL_TEXT>",
  "linguistic_form": "explicit_obligation | prohibition | conditional_obligation | exception | responsibility_assignment | implicit_requirement",
  "detection_confidence": 0.0-1.0,
  "rationale": "<one sentence>"
}

Return an object: {"spans": [ ... ]}. If no normative spans are present, return {"spans": []}.
Preserve original wording exactly; do not paraphrase span_text.', true),

('extraction', 1,
'You are extracting PROCESS ATOMS from a candidate normative span, per the Tarento Labs specification.

Contract (do not violate):
1. Emit exactly ONE atom per independently changeable behavioral rule.
   - A rule + its enforcement consequence is ONE atom (the consequence goes in action.on_noncompliance).
   - Two independently changeable obligations become TWO atoms in the returned array.
2. Preserve every threshold, quantifier, deadline, negation, and exception verbatim in the atom fields.
3. Strictly separate applicability (WHEN) / action (WHAT) / purpose (WHY).
4. Derive applicability from: the span, the section heading path, document metadata, supplied domain context.
5. NEVER assume universal scope when scope is absent. If a dimension is not stated, emit
   {"value": null, "status": "not_stated", "requires_review": true}.
   Do NOT use "*" or "all" as a placeholder. Silence is not universality.
6. For every field, evidence.derivation is: explicit | inherited | inferred | unknown.
7. Include an exact evidence quote and page/section for each derivation.
8. Do not create rules from explanatory examples.
9. purpose.execution_authoritative MUST be false.
10. atom_id is a stable dotted slug: <domain>.<object>.<rule-slug> (lowercase, kebab-case parts).

Atomicity test: "Can this requirement be independently retrieved, approved, changed, superseded, or violated?" If yes, it is a separate atom.

Return schema-valid JSON: {"atoms": [ ProcessAtom, ... ]}.
Return {"atoms": []} if the span does not encode a rule after all.', true)
ON CONFLICT DO NOTHING;
