import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { DocumentLayout, DocumentBlock } from "./types";

export async function buildContextWindows(
  admin: SupabaseClient<Database>,
  sourceId: string,
): Promise<number> {
  const { data: doc } = await admin
    .from("source_documents")
    .select("layout, source_id, sources!inner(source_type, title)")
    .eq("source_id", sourceId)
    .maybeSingle();
  if (!doc) throw new Error("Source not parsed yet");
  const layout = doc.layout as unknown as DocumentLayout;
  const source = (doc as unknown as { sources: { source_type: string; title: string } }).sources;

  await admin.from("context_windows").delete().eq("source_id", sourceId);

  const documentContext = {
    title: source.title,
    document_type: source.source_type,
    jurisdiction: null as string | null,
  };

  const eligible: DocumentBlock[] = layout.blocks.filter((b) => b.type !== "heading");

  const rows = eligible.map((block, i) => {
    const prev = eligible[i - 1];
    const next = eligible[i + 1];
    return {
      source_id: sourceId,
      local_text: block.text,
      preceding_paragraph: prev?.text ?? null,
      following_paragraph: next?.text ?? null,
      char_start: block.char_start,
      char_end: block.char_end,
      document_context: documentContext as never,
      section_context: { heading_path: block.heading_path, page: block.page } as never,
    };
  });

  if (rows.length === 0) return 0;
  // Insert in batches
  const batchSize = 200;
  for (let i = 0; i < rows.length; i += batchSize) {
    const { error } = await admin.from("context_windows").insert(rows.slice(i, i + batchSize));
    if (error) throw error;
  }
  return rows.length;
}
