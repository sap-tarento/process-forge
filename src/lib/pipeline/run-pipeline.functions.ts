import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ─────────────────────────────────────────────────────────────────────────────
// Client-driven, batch-resumable pipeline stepper.
//
//   startPipelineRun(sourceId)  → creates change_set + pipeline_runs + 14 stage
//                                  rows (1–2 succeeded, 3–12 pending, 13–14 awaiting_review).
//   advancePipelineRun(runId)   → runs ONE bounded batch of the current stage,
//                                  data-driven via cursor columns so resuming is
//                                  always safe. Returns { stage, done, counts }.
//   markPipelineRunFailed(runId, reason) → curator+ escape hatch.
//
// Each advance call performs at most a handful of LLM calls, well under the
// serverless request timeout. The client polls advance until done or failed.
// ─────────────────────────────────────────────────────────────────────────────

const CURATOR_ROLES = ["admin", "curator", "policy_owner"] as const;

const StartInput = z.object({ sourceId: z.string().uuid() });
const AdvanceInput = z.object({ runId: z.string().uuid() });
const FailInput = z.object({ runId: z.string().uuid(), reason: z.string().max(500).optional() });

// Stages the auto-stepper is responsible for. Stages 1–2 are marked succeeded
// at startup; 13–14 are awaiting_review and executed via applyChangeSet after
// human approval.
const AUTO_STAGES = [
  "document_section_classification",
  "candidate_span_detection",
  "atomic_decomposition",
  "phi_a_p_extraction",
  "domain_grounding",
  "provenance_binding",
  "quality_validation",
  "memory_retrieval",
  "conflict_analysis",
  "change_set_generation",
] as const;
type AutoStage = (typeof AUTO_STAGES)[number];

export const startPipelineRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => StartInput.parse(v))
  .handler(async ({ data, context }) => {
    const { data: allowed } = await context.supabase.rpc("has_any_role", {
      _roles: CURATOR_ROLES as unknown as ("admin" | "curator" | "policy_owner")[],
      _user_id: context.userId,
    });
    if (!allowed) throw new Error("Forbidden: curator+ role required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { PIPELINE_STAGES } = await import("@/types/atom");

    const { data: src, error: srcErr } = await supabaseAdmin
      .from("sources")
      .select("id, status")
      .eq("id", data.sourceId)
      .single();
    if (srcErr) throw new Error(`Source lookup failed: ${srcErr.message}`);
    if (!src) throw new Error("Source not found");
    if (src.status === "registered") {
      throw new Error("Run 'Parse' first — source must be at least in parsed state");
    }

    const { data: cs, error: csErr } = await supabaseAdmin
      .from("change_sets")
      .insert({
        source_id: data.sourceId,
        status: "draft",
        created_by: context.userId,
        summary: `Pipeline run ${new Date().toISOString()}`,
      })
      .select("id")
      .single();
    if (csErr || !cs) throw new Error(`change_set insert failed: ${csErr?.message ?? "unknown"}`);

    const { data: run, error: runErr } = await supabaseAdmin
      .from("pipeline_runs")
      .insert({
        source_id: data.sourceId,
        status: "running",
        triggered_by: context.userId,
        change_set_id: cs.id,
      })
      .select("id")
      .single();
    if (runErr || !run) throw new Error(`pipeline_run insert failed: ${runErr?.message ?? "unknown"}`);

    const stageRows = PIPELINE_STAGES.map((stage) => {
      let status: string = "pending";
      if (stage === "source_registration" || stage === "layout_aware_parsing") status = "succeeded";
      if (stage === "human_review" || stage === "versioned_publication") status = "awaiting_review";
      return { run_id: run.id, stage, status, counts: {} as Record<string, number> };
    });
    const { error: stagesErr } = await supabaseAdmin.from("pipeline_run_stages").insert(stageRows);
    if (stagesErr) {
      // Roll the run into failed so it isn't stranded at "running" with no stage rows.
      await supabaseAdmin
        .from("pipeline_runs")
        .update({ status: "failed", error: `stage seed failed: ${stagesErr.message}`, finished_at: new Date().toISOString() })
        .eq("id", run.id);
      throw new Error(`pipeline_run_stages seed failed: ${stagesErr.message}`);
    }

    return { run_id: run.id, change_set_id: cs.id };
  });

export const advancePipelineRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => AdvanceInput.parse(v))
  .handler(async ({ data, context }) => {
    const { data: allowed } = await context.supabase.rpc("has_any_role", {
      _roles: CURATOR_ROLES as unknown as ("admin" | "curator" | "policy_owner")[],
      _user_id: context.userId,
    });
    if (!allowed) throw new Error("Forbidden: curator+ role required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: run, error: runErr } = await supabaseAdmin
      .from("pipeline_runs")
      .select("id, source_id, status, change_set_id")
      .eq("id", data.runId)
      .single();
    if (runErr || !run) throw new Error(`pipeline_run lookup failed: ${runErr?.message ?? "not found"}`);

    if (run.status !== "running") {
      return { stage: null, stage_status: null, run_status: run.status, done: true, counts: {} };
    }
    if (!run.change_set_id) throw new Error("Pipeline run is missing its change_set");

    const { data: stages, error: stErr } = await supabaseAdmin
      .from("pipeline_run_stages")
      .select("id, stage, status, counts")
      .eq("run_id", run.id);
    if (stErr) throw new Error(`stage lookup failed: ${stErr.message}`);

    const stageByName = new Map(stages?.map((s) => [s.stage, s]) ?? []);
    const current = AUTO_STAGES.find((s) => {
      const row = stageByName.get(s);
      return row?.status === "pending" || row?.status === "running";
    });

    if (!current) {
      // All auto stages done — finalize.
      return await finalizeRun(supabaseAdmin, run.id, run.source_id, run.change_set_id, context.userId);
    }

    const stageRow = stageByName.get(current)!;
    const firstBatch = stageRow.status === "pending";
    if (firstBatch) {
      await setStage(supabaseAdmin, run.id, current, {
        status: "running",
        started_at: new Date().toISOString(),
      });
    }

    try {
      const { counts, remaining } = await runStageBatch(
        supabaseAdmin,
        current,
        run.source_id,
        run.change_set_id,
        firstBatch,
      );

      const merged = mergeCounts((stageRow.counts as Record<string, number>) ?? {}, counts);
      const done = remaining === 0;
      await setStage(supabaseAdmin, run.id, current, {
        counts: merged as never,
        ...(done
          ? { status: "succeeded", finished_at: new Date().toISOString() }
          : {}),
      });

      return {
        stage: current,
        stage_status: done ? "succeeded" : "running",
        run_status: "running",
        done: false,
        counts: merged,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await setStage(supabaseAdmin, run.id, current, {
        status: "failed",
        error: msg,
        finished_at: new Date().toISOString(),
      });
      await supabaseAdmin
        .from("pipeline_runs")
        .update({ status: "failed", error: msg, finished_at: new Date().toISOString() })
        .eq("id", run.id);
      throw e;
    }
  });

export const markPipelineRunFailed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => FailInput.parse(v))
  .handler(async ({ data, context }) => {
    const { data: allowed } = await context.supabase.rpc("has_any_role", {
      _roles: CURATOR_ROLES as unknown as ("admin" | "curator" | "policy_owner")[],
      _user_id: context.userId,
    });
    if (!allowed) throw new Error("Forbidden: curator+ role required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const reason = data.reason ?? "Marked as failed by curator";
    const { error } = await supabaseAdmin
      .from("pipeline_runs")
      .update({ status: "failed", error: reason, finished_at: new Date().toISOString() })
      .eq("id", data.runId)
      .eq("status", "running");
    if (error) throw new Error(`Could not mark run failed: ${error.message}`);
    return { ok: true };
  });

// ─────────────────────────── helpers ────────────────────────────

type Admin = Awaited<ReturnType<typeof getAdmin>>;
async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function setStage(
  admin: Admin,
  runId: string,
  stage: string,
  patch: Record<string, unknown>,
) {
  const { error } = await admin
    .from("pipeline_run_stages")
    .update(patch as never)
    .eq("run_id", runId)
    .eq("stage", stage);
  if (error) throw new Error(`stage update failed (${stage}): ${error.message}`);
}

function mergeCounts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

async function runStageBatch(
  admin: Admin,
  stage: AutoStage,
  sourceId: string,
  changeSetId: string,
  firstBatch: boolean,
): Promise<{ counts: Record<string, number>; remaining: number }> {
  switch (stage) {
    case "document_section_classification": {
      const { buildContextWindows } = await import("./build-windows.server");
      const windows = await buildContextWindows(admin, sourceId);
      return { counts: { windows_built: windows }, remaining: 0 };
    }
    case "candidate_span_detection": {
      const { detectSpansForSource } = await import("./detect-spans.server");
      const r = await detectSpansForSource(admin, sourceId, { batchSize: 3, wipe: firstBatch });
      return {
        counts: { spans_detected: r.detected, windows_processed: r.windows_processed },
        remaining: r.remaining,
      };
    }
    case "atomic_decomposition":
    case "phi_a_p_extraction": {
      // Combined per the paper (extract-atoms produces atoms with Φ/A/P in one LLM call).
      // We only actually do work when the extraction stage is current; the OTHER of the
      // pair completes deterministically with 0 remaining rows to process.
      const { extractAtomsForSource } = await import("./extract-atoms.server");
      const r = await extractAtomsForSource(admin, sourceId, changeSetId, { batchSize: 3 });
      return {
        counts: {
          atoms_drafted: r.produced,
          blocked_by_validation: r.blocked,
        },
        remaining: r.remaining,
      };
    }
    case "domain_grounding": {
      const { groundDomainForChangeSet } = await import("./ground-tags.server");
      const r = await groundDomainForChangeSet(admin, changeSetId, { batchSize: 2 });
      return {
        counts: {
          atoms_tagged: r.tagged,
          new_vocabulary_proposed: r.proposed,
          atoms_embedded: r.embedded,
          failed: r.failed,
        },
        remaining: r.remaining,
      };
    }
    case "provenance_binding": {
      const { bindProvenanceForChangeSet } = await import("./bind-provenance.server");
      const r = await bindProvenanceForChangeSet(admin, changeSetId);
      return {
        counts: {
          evidence_bound: r.bound,
          evidence_unresolved: r.unresolved,
          atoms_flagged: r.atoms_flagged,
        },
        remaining: r.remaining,
      };
    }
    case "quality_validation": {
      const { validateQualityForChangeSet } = await import("./validate-quality.server");
      const r = await validateQualityForChangeSet(admin, changeSetId, { batchSize: 3 });
      return {
        counts: {
          atoms_validated: r.validated,
          publication_blocked: r.publication_blocked,
          average_atomicity_x100: Math.round((r.average_atomicity ?? 0) * 100),
        },
        remaining: r.remaining,
      };
    }
    case "memory_retrieval": {
      const { retrieveMemoryForChangeSet } = await import("./retrieve-memory.server");
      const r = await retrieveMemoryForChangeSet(admin, changeSetId);
      return {
        counts: {
          items_processed: r.items_processed,
          neighbors_found: r.neighbors_found,
          candidates_considered: r.candidates_considered,
        },
        remaining: r.remaining,
      };
    }
    case "conflict_analysis": {
      const { analyzeConflictsForChangeSet } = await import("./analyze-conflicts.server");
      const r = await analyzeConflictsForChangeSet(admin, changeSetId, { batchSize: 5 });
      return {
        counts: {
          pairs_examined: r.pairs_examined,
          duplicates: r.duplicates,
          specializations: r.specializations,
          overlaps: r.overlaps,
          conflicts: r.conflicts,
          comparator_calls: r.comparator_calls,
        },
        remaining: r.remaining,
      };
    }
    case "change_set_generation": {
      const { generateChangeSet } = await import("./generate-change-set.server");
      const r = await generateChangeSet(admin, changeSetId);
      return { counts: r as unknown as Record<string, number>, remaining: 0 };
    }
  }
}

async function finalizeRun(
  admin: Admin,
  runId: string,
  sourceId: string,
  changeSetId: string,
  actorId: string,
) {
  const now = new Date().toISOString();
  // Change_set moves to pending_review inside generateChangeSet already; make sure.
  await admin.from("change_sets").update({ status: "pending_review" } as never).eq("id", changeSetId);

  const { error: sErr } = await admin
    .from("sources")
    .update({ status: "extracted", updated_at: now })
    .eq("id", sourceId);
  if (sErr) throw new Error(`source status update failed: ${sErr.message}`);

  const { error: rErr } = await admin
    .from("pipeline_runs")
    .update({ status: "succeeded", finished_at: now })
    .eq("id", runId);
  if (rErr) throw new Error(`pipeline_run finalize failed: ${rErr.message}`);

  await admin.from("audit_events").insert({
    event_type: "pipeline.run.succeeded",
    entity_type: "pipeline_run",
    entity_id: runId,
    actor: actorId,
    payload: { change_set_id: changeSetId } as never,
  });

  return {
    stage: null,
    stage_status: null,
    run_status: "succeeded",
    done: true,
    counts: {} as Record<string, number>,
  };
}
