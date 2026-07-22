
-- Extensions
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============ Enums ============
CREATE TYPE public.app_role AS ENUM ('admin', 'policy_owner', 'curator', 'reviewer', 'viewer');
CREATE TYPE public.source_type AS ENUM ('POLICY','SOP','REGULATION','ERP_CONFIG','EVENT_LOG','AGENT_TRACE','BPMN_MODEL','EXPERT_INPUT');
CREATE TYPE public.authority_class AS ENUM ('NORMATIVE','DESCRIPTIVE');
CREATE TYPE public.source_status AS ENUM ('registered','parsed','extracting','extracted','failed');
CREATE TYPE public.linguistic_form AS ENUM ('explicit_obligation','prohibition','conditional_obligation','exception','responsibility_assignment','implicit_requirement');
CREATE TYPE public.atom_status AS ENUM ('candidate','under_review','approved','active','superseded','withdrawn');
CREATE TYPE public.knowledge_type AS ENUM ('OBLIGATION','PROHIBITION','PERMISSION','RESPONSIBILITY','DECISION_RULE','DATA_REQUIREMENT','ESCALATION','SEQUENCE','TEMPORAL_RULE','EXCEPTION');
CREATE TYPE public.relationship_type AS ENUM ('DUPLICATES','OVERLAPS','CONFLICTS_WITH','SPECIALIZES','GENERALIZES','SUPERSEDES','DEPENDS_ON','EXCEPTION_TO','DERIVED_FROM','IMPLEMENTS');
CREATE TYPE public.domain_category AS ENUM ('corporate_function','end_to_end_process','process','activity','business_object','role','system','organizational_unit');
CREATE TYPE public.change_set_status AS ENUM ('draft','pending_review','partially_applied','applied','rejected');
CREATE TYPE public.change_op AS ENUM ('add','modify','remove','no_change','conflict_review');
CREATE TYPE public.review_status AS ENUM ('pending','approved','edited_approved','rejected');
CREATE TYPE public.conflict_kind AS ENUM ('duplicate','overlap','specializes','generalizes','incompatible_action');
CREATE TYPE public.conflict_status AS ENUM ('open','resolved','dismissed');
CREATE TYPE public.candidate_status AS ENUM ('pending','accepted','rejected');

-- ============ Utility ============
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ============ user_roles ============
CREATE TABLE public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id UUID, _roles public.app_role[])
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles));
$$;

CREATE POLICY "Users read their own role" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins read all roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- First user becomes admin; everyone else becomes viewer
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing_count INT;
BEGIN
  SELECT count(*) INTO existing_count FROM public.user_roles;
  IF existing_count = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'viewer');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ sources ============
CREATE TABLE public.sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  source_type public.source_type NOT NULL,
  authority_class public.authority_class NOT NULL,
  version TEXT NOT NULL,
  effective_date DATE,
  owner TEXT,
  approval_status TEXT,
  superseded_source_id UUID REFERENCES public.sources(id) ON DELETE SET NULL,
  file_path TEXT,
  file_sha256 TEXT,
  raw_text TEXT,
  ingestion_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  status public.source_status NOT NULL DEFAULT 'registered',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sources TO authenticated;
GRANT ALL ON public.sources TO service_role;
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in read sources" ON public.sources FOR SELECT TO authenticated USING (true);
CREATE POLICY "Curators+ insert sources" ON public.sources FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner','curator']::public.app_role[]));
CREATE POLICY "Curators+ update sources" ON public.sources FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner','curator']::public.app_role[]));
CREATE POLICY "Admins delete sources" ON public.sources FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_sources_updated BEFORE UPDATE ON public.sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ source_documents ============
CREATE TABLE public.source_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES public.sources(id) ON DELETE CASCADE,
  parser_version TEXT NOT NULL,
  page_count INT,
  layout JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.source_documents TO authenticated;
GRANT ALL ON public.source_documents TO service_role;
ALTER TABLE public.source_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in read source_documents" ON public.source_documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "Curators+ write source_documents" ON public.source_documents FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner','curator']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner','curator']::public.app_role[]));

-- ============ context_windows ============
CREATE TABLE public.context_windows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES public.sources(id) ON DELETE CASCADE,
  document_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  section_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  local_text TEXT NOT NULL,
  preceding_paragraph TEXT,
  following_paragraph TEXT,
  char_start INT,
  char_end INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.context_windows TO authenticated;
GRANT ALL ON public.context_windows TO service_role;
ALTER TABLE public.context_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in read context_windows" ON public.context_windows FOR SELECT TO authenticated USING (true);
CREATE POLICY "Curators+ write context_windows" ON public.context_windows FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner','curator']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner','curator']::public.app_role[]));

-- ============ candidate_spans ============
CREATE TABLE public.candidate_spans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  context_window_id UUID NOT NULL REFERENCES public.context_windows(id) ON DELETE CASCADE,
  span_text TEXT NOT NULL,
  linguistic_form public.linguistic_form NOT NULL,
  detection_confidence NUMERIC(4,3),
  status public.candidate_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_spans TO authenticated;
GRANT ALL ON public.candidate_spans TO service_role;
ALTER TABLE public.candidate_spans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in read candidate_spans" ON public.candidate_spans FOR SELECT TO authenticated USING (true);
CREATE POLICY "Curators+ write candidate_spans" ON public.candidate_spans FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner','curator']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner','curator']::public.app_role[]));

-- ============ atoms ============
CREATE TABLE public.atoms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  atom_id TEXT NOT NULL,
  version INT NOT NULL,
  name TEXT NOT NULL,
  status public.atom_status NOT NULL DEFAULT 'candidate',
  knowledge_type public.knowledge_type NOT NULL,
  applicability JSONB NOT NULL DEFAULT '{}'::jsonb,
  action JSONB NOT NULL DEFAULT '{}'::jsonb,
  purpose JSONB NOT NULL DEFAULT '{}'::jsonb,
  domain_tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  governance JSONB NOT NULL DEFAULT '{}'::jsonb,
  quality JSONB NOT NULL DEFAULT '{}'::jsonb,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  transaction_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  embedding vector(1536),
  -- denormalized filter columns
  processes TEXT[] NOT NULL DEFAULT '{}',
  activities TEXT[] NOT NULL DEFAULT '{}',
  roles TEXT[] NOT NULL DEFAULT '{}',
  business_objects TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (atom_id, version)
);
CREATE INDEX atoms_status_idx ON public.atoms (status);
CREATE INDEX atoms_knowledge_type_idx ON public.atoms (knowledge_type);
CREATE INDEX atoms_processes_idx ON public.atoms USING GIN (processes);
CREATE INDEX atoms_activities_idx ON public.atoms USING GIN (activities);
CREATE INDEX atoms_roles_idx ON public.atoms USING GIN (roles);
CREATE INDEX atoms_business_objects_idx ON public.atoms USING GIN (business_objects);
CREATE INDEX atoms_domain_tags_idx ON public.atoms USING GIN (domain_tags);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.atoms TO authenticated;
GRANT ALL ON public.atoms TO service_role;
ALTER TABLE public.atoms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in read atoms" ON public.atoms FOR SELECT TO authenticated USING (true);
CREATE POLICY "Curators+ insert atoms" ON public.atoms FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner','curator']::public.app_role[]));
CREATE POLICY "Curators+ update candidate atoms" ON public.atoms FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner','curator','reviewer']::public.app_role[]));
CREATE POLICY "Owners delete atoms" ON public.atoms FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner']::public.app_role[]));
CREATE TRIGGER trg_atoms_updated BEFORE UPDATE ON public.atoms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ atom_relationships ============
CREATE TABLE public.atom_relationships (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  from_atom UUID NOT NULL REFERENCES public.atoms(id) ON DELETE CASCADE,
  to_atom_id TEXT NOT NULL,
  relationship_type public.relationship_type NOT NULL,
  rationale TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.atom_relationships TO authenticated;
GRANT ALL ON public.atom_relationships TO service_role;
ALTER TABLE public.atom_relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in read atom_relationships" ON public.atom_relationships FOR SELECT TO authenticated USING (true);
CREATE POLICY "Curators+ write atom_relationships" ON public.atom_relationships FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner','curator']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner','curator']::public.app_role[]));

-- ============ domain_model ============
CREATE TABLE public.domain_model (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category public.domain_category NOT NULL,
  value TEXT NOT NULL,
  label TEXT NOT NULL,
  parent_id UUID REFERENCES public.domain_model(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (category, value)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.domain_model TO authenticated;
GRANT ALL ON public.domain_model TO service_role;
ALTER TABLE public.domain_model ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in read domain_model" ON public.domain_model FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage domain_model" ON public.domain_model FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ change_sets + items ============
CREATE TABLE public.change_sets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID REFERENCES public.sources(id) ON DELETE SET NULL,
  status public.change_set_status NOT NULL DEFAULT 'draft',
  summary TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.change_sets TO authenticated;
GRANT ALL ON public.change_sets TO service_role;
ALTER TABLE public.change_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in read change_sets" ON public.change_sets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Curators+ write change_sets" ON public.change_sets FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner','curator']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner','curator']::public.app_role[]));
CREATE TRIGGER trg_change_sets_updated BEFORE UPDATE ON public.change_sets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.change_set_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  change_set_id UUID NOT NULL REFERENCES public.change_sets(id) ON DELETE CASCADE,
  operation public.change_op NOT NULL,
  atom_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  existing_atom UUID REFERENCES public.atoms(id) ON DELETE SET NULL,
  validation_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  curator_notes TEXT,
  review_status public.review_status NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.change_set_items TO authenticated;
GRANT ALL ON public.change_set_items TO service_role;
ALTER TABLE public.change_set_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in read change_set_items" ON public.change_set_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Curators+ insert change_set_items" ON public.change_set_items FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner','curator']::public.app_role[]));
CREATE POLICY "Reviewers+ update change_set_items" ON public.change_set_items FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner','reviewer','curator']::public.app_role[]));
CREATE POLICY "Owners delete change_set_items" ON public.change_set_items FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner']::public.app_role[]));

-- ============ conflicts + resolutions ============
CREATE TABLE public.conflicts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  atom_a UUID NOT NULL REFERENCES public.atoms(id) ON DELETE CASCADE,
  atom_b_atom_id TEXT NOT NULL,
  conflict_kind public.conflict_kind NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  status public.conflict_status NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conflicts TO authenticated;
GRANT ALL ON public.conflicts TO service_role;
ALTER TABLE public.conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in read conflicts" ON public.conflicts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Curators+ insert conflicts" ON public.conflicts FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner','curator']::public.app_role[]));
CREATE POLICY "Owners update conflicts" ON public.conflicts FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner']::public.app_role[]));

CREATE TABLE public.resolutions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conflict_id UUID NOT NULL REFERENCES public.conflicts(id) ON DELETE CASCADE,
  strategy TEXT NOT NULL,
  winning_atom_id TEXT,
  reason TEXT,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resolutions TO authenticated;
GRANT ALL ON public.resolutions TO service_role;
ALTER TABLE public.resolutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in read resolutions" ON public.resolutions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Owners write resolutions" ON public.resolutions FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner']::public.app_role[]));

-- ============ precedence_strategies ============
CREATE TABLE public.precedence_strategies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  priority_order JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.precedence_strategies TO authenticated;
GRANT ALL ON public.precedence_strategies TO service_role;
ALTER TABLE public.precedence_strategies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in read precedence_strategies" ON public.precedence_strategies FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage precedence_strategies" ON public.precedence_strategies FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_precedence_updated BEFORE UPDATE ON public.precedence_strategies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed disabled precedence strategies (org must explicitly enable)
INSERT INTO public.precedence_strategies (name, description, priority_order, enabled) VALUES
  ('more_specific_rule_overrides_general_rule','When two atoms overlap, the one with the more specific applicability scope wins.','[]'::jsonb, false),
  ('higher_authority_overrides','When two atoms overlap, the one whose governance authority is higher wins (regulatory > board > executive > functional > local).','[]'::jsonb, false),
  ('later_effective_date_overrides','When two atoms overlap and have equal authority, the one with the later effective date wins.','[]'::jsonb, false);

-- ============ audit_events ============
CREATE TABLE public.audit_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  actor UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_entity_idx ON public.audit_events(entity_type, entity_id);
CREATE INDEX audit_events_created_idx ON public.audit_events(created_at DESC);
GRANT SELECT, INSERT ON public.audit_events TO authenticated;
GRANT ALL ON public.audit_events TO service_role;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners+admins read audit_events" ON public.audit_events FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','policy_owner']::public.app_role[]));
CREATE POLICY "Signed-in append audit_events" ON public.audit_events FOR INSERT TO authenticated
  WITH CHECK (actor = auth.uid() OR actor IS NULL);

-- ============ llm_settings ============
CREATE TABLE public.llm_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'lovable',
  model TEXT NOT NULL DEFAULT 'google/gemini-2.5-flash',
  api_key_secret_name TEXT,
  embedding_provider TEXT NOT NULL DEFAULT 'lovable',
  embedding_model TEXT NOT NULL DEFAULT 'google/text-embedding-004',
  singleton BOOLEAN NOT NULL DEFAULT true UNIQUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.llm_settings TO authenticated;
GRANT ALL ON public.llm_settings TO service_role;
ALTER TABLE public.llm_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in read llm_settings" ON public.llm_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage llm_settings" ON public.llm_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_llm_settings_updated BEFORE UPDATE ON public.llm_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
INSERT INTO public.llm_settings (singleton) VALUES (true);

-- ============ prompt_versions ============
CREATE TABLE public.prompt_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  prompt_key TEXT NOT NULL,
  version INT NOT NULL,
  template TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (prompt_key, version)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prompt_versions TO authenticated;
GRANT ALL ON public.prompt_versions TO service_role;
ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in read prompt_versions" ON public.prompt_versions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage prompt_versions" ON public.prompt_versions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
