import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({ sourceId: z.string().uuid() });

export const parseSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => Input.parse(v))
  .handler(async ({ data, context }) => {
    // Authorization check — curator+ via the caller's own RLS
    const { data: allowed } = await context.supabase.rpc("has_any_role", {
      _roles: ["admin", "curator", "policy_owner"],
      _user_id: context.userId,
    });
    if (!allowed) throw new Error("Forbidden: curator+ role required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { parsePdfBytes, parsePlainText } = await import("./pdf.server");
    const { PARSER_VERSION } = await import("./version");

    const { data: src, error: srcErr } = await supabaseAdmin
      .from("sources")
      .select("*")
      .eq("id", data.sourceId)
      .single();
    if (srcErr) throw srcErr;

    // Get bytes / text
    let layout;
    if (src.raw_text) {
      layout = parsePlainText(src.raw_text);
    } else if (src.file_path) {
      const { data: blob, error: dlErr } = await supabaseAdmin.storage
        .from("source-files")
        .download(src.file_path);
      if (dlErr || !blob) throw new Error(`Could not download file: ${dlErr?.message}`);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const name = src.file_path.toLowerCase();
      if (name.endsWith(".pdf")) {
        layout = await parsePdfBytes(bytes);
      } else {
        layout = parsePlainText(new TextDecoder().decode(bytes));
      }
    } else {
      throw new Error("Source has neither raw_text nor file_path");
    }

    // Upsert source_documents (replace prior parse for this source)
    await supabaseAdmin.from("source_documents").delete().eq("source_id", src.id);
    const { error: insErr } = await supabaseAdmin.from("source_documents").insert({
      source_id: src.id,
      parser_version: PARSER_VERSION,
      page_count: layout.page_count,
      layout: layout as never,
    });
    if (insErr) throw insErr;

    // Update source status
    await supabaseAdmin
      .from("sources")
      .update({ status: "parsed", updated_at: new Date().toISOString() })
      .eq("id", src.id);

    await supabaseAdmin.from("audit_events").insert({
      event_type: "source.parsed",
      entity_type: "source",
      entity_id: src.id,
      actor: context.userId,
      payload: { block_count: layout.blocks.length, page_count: layout.page_count } as never,
    });

    return {
      block_count: layout.blocks.length,
      page_count: layout.page_count,
      heading_count: layout.blocks.filter((b) => b.type === "heading").length,
      paragraph_count: layout.blocks.filter((b) => b.type === "paragraph").length,
      list_item_count: layout.blocks.filter((b) => b.type === "list_item").length,
    };
  });
