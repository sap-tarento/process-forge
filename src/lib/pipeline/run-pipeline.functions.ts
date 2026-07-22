import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({ sourceId: z.string().uuid() });

/**
 * Runs pipeline stages 3 → 6 for a parsed source. Records progress per stage
 * in pipeline_run_stages. Stages 7-14 are recorded as "not_implemented".
 */
export const runPipeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => Input.parse(v))
  .handler(async ({ data, context }) => {
    const { data: allowed } = await context.supabase.rpc("has_any_role", {
      _roles: ["admin", "curator", "policy_owner"],
      _user_id: context.userId,
    });
    if (!allowed) throw new Error("Forbidden: curator+ role required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { buildContextWindows } = await import("./build-windows.server");
    const { detectSpansForSource } = await import("./detect-spans.server");
    const { extractAtomsForSource } = await import("./extract-atoms.server");
    const { groundDomainForChangeSet } = await import("./ground-tags.server");
    const { bindProvenanceForChangeSet } = await import("./bind-provenance.server");
    const { validateQualityForChangeSet } = await import("./validate-quality.server");
    const { PIPELINE_STAGES } = await import("@/types/atom");

    // Ensure the source is parsed
    const { data: src } = await supabaseAdmin
      .from("sources")
      .select("id, status")
      .eq("id", data.sourceId)
      .single();
    if (!src) throw new Error("Source not found");
    if (src.status === "registered") {
      throw new Error("Run 'Parse' first — source must be at least in parsed state");
    }

    // Create a change_set for this run
    const { data: cs, error: csErr } = await supabaseAdmin
      .from("change_sets")
      .insert({ source_id: data.sourceId, status: "draft", created_by: context.userId, summary: `Pipeline run ${new Date().toISOString()}` })
      .select("id")
      .single();
    if (csErr || !cs) throw csErr ?? new Error("Could not create change_set");

    // Create pipeline_runs row
    const { data: run, error: runErr } = await supabaseAdmin
      .from("pipeline_runs")
      .insert({ source_id: data.sourceId, status: "running", triggered_by: context.userId, change_set_id: cs.id })
      .select("id")
      .single();
    if (runErr || !run) throw runErr ?? new Error("Could not create pipeline_run");

    // Prepare stage rows
    const stageRows = PIPELINE_STAGES.map((stage) => ({
      run_id: run.id,
      stage,
      status: stage === "source_registration" || stage === "layout_aware_parsing" ? "succeeded" : "pending",
      counts: {} as Record<string, number>,
    }));
    await supabaseAdmin.from("pipeline_run_stages").insert(stageRows);

    const setStage = async (stage: string, patch: Record<string, unknown>) => {
      await supabaseAdmin
        .from("pipeline_run_stages")
        .update(patch as never)
        .eq("run_id", run.id)
        .eq("stage", stage);
    };

    try {
      // Stage 3 — context windows
      await setStage("document_section_classification", { status: "running", started_at: new Date().toISOString() });
      const windows = await buildContextWindows(supabaseAdmin, data.sourceId);
      await setStage("document_section_classification", {
        status: "succeeded",
        finished_at: new Date().toISOString(),
        counts: { windows_built: windows } as never,
      });

      // Stage 4 — span detection
      await setStage("candidate_span_detection", { status: "running", started_at: new Date().toISOString() });
      const spans = await detectSpansForSource(supabaseAdmin, data.sourceId);
      await setStage("candidate_span_detection", {
        status: "succeeded",
        finished_at: new Date().toISOString(),
        counts: { spans_detected: spans.detected, windows_processed: spans.windows_processed } as never,
      });

      // Stages 5 + 6 — decomposition + Φ/A/P extraction (combined LLM call)
      await setStage("atomic_decomposition", { status: "running", started_at: new Date().toISOString() });
      await setStage("phi_a_p_extraction", { status: "running", started_at: new Date().toISOString() });
      const extract = await extractAtomsForSource(supabaseAdmin, data.sourceId, cs.id);
      const now = new Date().toISOString();
      await setStage("atomic_decomposition", {
        status: "succeeded",
        finished_at: now,
        counts: { atoms_drafted: extract.produced } as never,
      });
      await setStage("phi_a_p_extraction", {
        status: "succeeded",
        finished_at: now,
        counts: { atoms_drafted: extract.produced, blocked_by_validation: extract.blocked } as never,
      });

      // Stage 7 — Enterprise domain grounding + embeddings
      await setStage("domain_grounding", { status: "running", started_at: new Date().toISOString() });
      const grounding = await groundDomainForChangeSet(supabaseAdmin, cs.id);
      await setStage("domain_grounding", {
        status: "succeeded",
        finished_at: new Date().toISOString(),
        counts: {
          atoms_tagged: grounding.tagged,
          new_vocabulary_proposed: grounding.proposed,
          atoms_embedded: grounding.embedded,
          failed: grounding.failed,
        } as never,
      });

      // Stage 8 — Provenance binding (deterministic)
      await setStage("provenance_binding", { status: "running", started_at: new Date().toISOString() });
      const provenance = await bindProvenanceForChangeSet(supabaseAdmin, cs.id);
      await setStage("provenance_binding", {
        status: "succeeded",
        finished_at: new Date().toISOString(),
        counts: {
          evidence_bound: provenance.bound,
          evidence_unresolved: provenance.unresolved,
          atoms_flagged: provenance.atoms_flagged,
        } as never,
      });

      // Stage 9 — Quality validation (4 layers)
      await setStage("quality_validation", { status: "running", started_at: new Date().toISOString() });
      const quality = await validateQualityForChangeSet(supabaseAdmin, cs.id);
      await setStage("quality_validation", {
        status: "succeeded",
        finished_at: new Date().toISOString(),
        counts: {
          atoms_validated: quality.validated,
          publication_blocked: quality.publication_blocked,
          average_atomicity: Math.round(quality.average_atomicity * 100),
        } as never,
      });

      // Stage 10 — existing-memory retrieval
      await setStage("memory_retrieval", { status: "running", started_at: new Date().toISOString() });
      const { retrieveMemoryForChangeSet } = await import("./retrieve-memory.server");
      const memory = await retrieveMemoryForChangeSet(supabaseAdmin, cs.id);
      await setStage("memory_retrieval", {
        status: "succeeded", finished_at: new Date().toISOString(),
        counts: { items_processed: memory.items_processed, neighbors_found: memory.neighbors_found, candidates_considered: memory.candidates_considered } as never,
      });

      // Stage 11 — conflict analysis (deterministic + comparator tiebreaker)
      await setStage("conflict_analysis", { status: "running", started_at: new Date().toISOString() });
      const { analyzeConflictsForChangeSet } = await import("./analyze-conflicts.server");
      const conflicts = await analyzeConflictsForChangeSet(supabaseAdmin, cs.id);
      await setStage("conflict_analysis", {
        status: "succeeded", finished_at: new Date().toISOString(),
        counts: {
          pairs_examined: conflicts.pairs_examined,
          duplicates: conflicts.duplicates,
          specializations: conflicts.specializations,
          overlaps: conflicts.overlaps,
          conflicts: conflicts.conflicts,
          comparator_calls: conflicts.comparator_calls,
        } as never,
      });

      // Stage 12 — contextualized change set generation
      await setStage("change_set_generation", { status: "running", started_at: new Date().toISOString() });
      const { generateChangeSet } = await import("./generate-change-set.server");
      const changeset = await generateChangeSet(supabaseAdmin, cs.id);
      await setStage("change_set_generation", {
        status: "succeeded", finished_at: new Date().toISOString(),
        counts: changeset as never,
      });

      // Stage 13 — awaits human review in the Review workspace
      await setStage("human_review", { status: "awaiting_review" });
      // Stage 14 — executed via applyChangeSet server function after approvals
      await setStage("versioned_publication", { status: "awaiting_review" });

      await supabaseAdmin
        .from("pipeline_runs")
        .update({ status: "succeeded", finished_at: new Date().toISOString() })
        .eq("id", run.id);
      await supabaseAdmin
        .from("sources")
        .update({ status: "extracted", updated_at: new Date().toISOString() })
        .eq("id", data.sourceId);

      await supabaseAdmin.from("audit_events").insert({
        event_type: "pipeline.run.succeeded",
        entity_type: "pipeline_run",
        entity_id: run.id,
        actor: context.userId,
        payload: { windows, spans, extract, grounding, provenance, quality, memory, conflicts, changeset } as never,
      });

      return {
        run_id: run.id,
        change_set_id: cs.id,
        ...extract,
        spans_detected: spans.detected,
        windows,
        grounding,
        provenance,
        quality,
        memory,
        conflicts,
        changeset,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabaseAdmin
        .from("pipeline_runs")
        .update({ status: "failed", error: msg, finished_at: new Date().toISOString() })
        .eq("id", run.id);
      throw e;
    }
  });
