
-- ============ notifications ============
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  atom_id text,
  change_set_item_id uuid,
  event_type text NOT NULL,
  summary text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_recipient_created_idx
  ON public.notifications(recipient, created_at DESC);

GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications_own_select" ON public.notifications
  FOR SELECT TO authenticated USING (recipient = auth.uid());
CREATE POLICY "notifications_own_update" ON public.notifications
  FOR UPDATE TO authenticated USING (recipient = auth.uid()) WITH CHECK (recipient = auth.uid());
CREATE POLICY "notifications_own_delete" ON public.notifications
  FOR DELETE TO authenticated USING (recipient = auth.uid());

-- ============ memory_state (cache generation counter) ============
CREATE TABLE IF NOT EXISTS public.memory_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  generation bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.memory_state (id, generation) VALUES (true, 0)
  ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.memory_state TO authenticated, anon;
GRANT ALL ON public.memory_state TO service_role;

ALTER TABLE public.memory_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "memory_state_read_all" ON public.memory_state
  FOR SELECT TO authenticated, anon USING (true);

-- ============ change_set_items extensions ============
ALTER TABLE public.change_set_items
  ADD COLUMN IF NOT EXISTS atom_embedding extensions.vector(1536),
  ADD COLUMN IF NOT EXISTS neighbors jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS conflict_findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS scenarios jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ============ seed prompt_versions for comparator + scenarios ============
INSERT INTO public.prompt_versions (prompt_key, version, template, active)
SELECT 'comparator', 1,
$$You are a policy comparator. You are given two Process Atoms (A and B) that a
deterministic comparator could not fully classify. Decide their relationship.

Return STRICT JSON only:
{
  "verdict": "duplicate" | "specializes_a_to_b" | "specializes_b_to_a" | "overlap_compatible" | "overlap_conflict" | "unrelated",
  "reason": "short explanation grounded in the atom fields",
  "conflict_kind": "incompatible_action" | "different_threshold" | "exclusive_routing" | "permit_vs_prohibit" | null
}

Definitions:
- duplicate: equivalent scope AND equivalent action (same modality, actor, operation, object, comparable parameters).
- specializes_a_to_b: A's scope is strictly a subset of B's on all dimensions and their actions are compatible.
- overlap_compatible: their scopes can co-apply, and their actions are cumulative and compatible.
- overlap_conflict: their scopes overlap AND their actions are incompatible (MUST vs MUST_NOT on same op/object, exclusive routing, different thresholds, permit vs prohibit).
- unrelated: scopes cannot co-apply.

Do NOT treat "not_stated" scope as universal. If a dimension is not_stated on either side,
treat it as UNKNOWN — do not conclude conflict from unknown scope; prefer overlap_compatible unless
action incompatibility is clearly stated in the atoms.$$,
true
WHERE NOT EXISTS (SELECT 1 FROM public.prompt_versions WHERE prompt_key='comparator');

INSERT INTO public.prompt_versions (prompt_key, version, template, active)
SELECT 'scenarios', 1,
$$You generate concrete runtime scenarios that let a human reviewer sanity-check
a Process Atom's behavior.

Given ONE atom (with applicability, action, purpose, and evidence), produce 2 to 4
scenario sentences. Each sentence must:
- describe a concrete situation matching the atom's applicability
- state the expected outcome under the atom's action modality
- reference the on_noncompliance behavior when relevant
- be plain-English, no jargon
- be self-contained (a reviewer should be able to judge correctness from the sentence alone)

Return STRICT JSON only:
{ "scenarios": [ { "situation": "...", "expected": "..." }, ... ] }$$,
true
WHERE NOT EXISTS (SELECT 1 FROM public.prompt_versions WHERE prompt_key='scenarios');
