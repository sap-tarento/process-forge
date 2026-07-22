
-- Widen pipeline_run_stages.status
ALTER TABLE public.pipeline_run_stages DROP CONSTRAINT IF EXISTS pipeline_run_stages_status_check;
ALTER TABLE public.pipeline_run_stages
  ADD CONSTRAINT pipeline_run_stages_status_check
  CHECK (status IN ('pending','running','succeeded','completed','failed','skipped','not_implemented','awaiting_review'));

-- Widen pipeline_runs.status
ALTER TABLE public.pipeline_runs DROP CONSTRAINT IF EXISTS pipeline_runs_status_check;
ALTER TABLE public.pipeline_runs
  ADD CONSTRAINT pipeline_runs_status_check
  CHECK (status IN ('running','succeeded','completed','failed','cancelled'));

-- Batch cursor columns
ALTER TABLE public.context_windows
  ADD COLUMN IF NOT EXISTS spans_detected_at timestamptz;

ALTER TABLE public.change_set_items
  ADD COLUMN IF NOT EXISTS grounded_at timestamptz,
  ADD COLUMN IF NOT EXISTS provenance_bound_at timestamptz,
  ADD COLUMN IF NOT EXISTS validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS curated_at timestamptz;

CREATE INDEX IF NOT EXISTS context_windows_source_pending_idx
  ON public.context_windows (source_id) WHERE spans_detected_at IS NULL;

CREATE INDEX IF NOT EXISTS change_set_items_grounded_pending_idx
  ON public.change_set_items (change_set_id) WHERE grounded_at IS NULL;
CREATE INDEX IF NOT EXISTS change_set_items_validated_pending_idx
  ON public.change_set_items (change_set_id) WHERE validated_at IS NULL;
CREATE INDEX IF NOT EXISTS change_set_items_curated_pending_idx
  ON public.change_set_items (change_set_id) WHERE curated_at IS NULL;
