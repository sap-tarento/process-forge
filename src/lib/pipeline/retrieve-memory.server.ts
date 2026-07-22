/**
 * Stage 10 — Existing-memory retrieval.
 *
 * For each draft atom in a change_set, retrieve top-N neighbor atoms from the
 * existing governed memory (status active OR approved) using a hybrid signal:
 *   - shared domain tags (jsonb intersection)
 *   - denormalized filter column overlap (processes / activities / roles / business_objects)
 *   - lexical similarity on name + action operation/object
 *   - embedding similarity (pgvector cosine) — when the change_set_item has an
 *     embedding and the neighbor atom has one too
 *   - same-source relationships (previous atoms derived from the same source)
 *
 * Persists the ranked neighbor list onto change_set_items.neighbors as JSONB.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ProcessAtom } from "@/types/atom";

const TOP_N = 8;

interface NeighborRow {
  id: string;
  atom_id: string;
  name: string;
  version: number;
  status: string;
  knowledge_type: string;
  action: unknown;
  applicability: unknown;
  domain_tags: unknown;
  provenance: unknown;
  processes: string[] | null;
  activities: string[] | null;
  roles: string[] | null;
  business_objects: string[] | null;
  embedding: number[] | null;
  source_id: string | null;
}

export interface RetrievedNeighbor {
  atom_db_id: string;
  atom_id: string;
  name: string;
  version: number;
  status: string;
  signals: {
    tag_overlap: number;
    filter_overlap: number;
    lexical: number;
    embedding: number;
    same_source: boolean;
  };
  score: number;
}

function overlapCount(a: string[] | null | undefined, b: string[] | null | undefined): number {
  if (!a?.length || !b?.length) return 0;
  const set = new Set(a.map((x) => x.toLowerCase()));
  let n = 0;
  for (const x of b) if (set.has(x.toLowerCase())) n++;
  return n;
}

function tagOverlap(a: ProcessAtom["domain_tags"] | undefined, b: unknown): number {
  if (!a || !b || typeof b !== "object") return 0;
  let n = 0;
  const bo = b as Record<string, unknown>;
  for (const [k, av] of Object.entries(a)) {
    const bv = bo[k];
    if (Array.isArray(av) && Array.isArray(bv)) n += overlapCount(av as string[], bv as string[]);
  }
  return n;
}

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/g).filter((t) => t.length > 2));
}
function jaccard(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function cosine(a: number[] | null, b: number[] | null): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function actionText(atom: ProcessAtom): string {
  const a = atom.action;
  return `${a?.modality ?? ""} ${a?.actor ?? ""} ${a?.operation ?? ""} ${a?.object ?? ""}`;
}
function rowActionText(a: unknown): string {
  const ao = (a as { modality?: string; actor?: string; operation?: string; object?: string }) ?? {};
  return `${ao.modality ?? ""} ${ao.actor ?? ""} ${ao.operation ?? ""} ${ao.object ?? ""}`;
}

export interface MemoryRetrievalOutcome {
  items_processed: number;
  neighbors_found: number;
  candidates_considered: number;
}

export async function retrieveMemoryForChangeSet(
  admin: SupabaseClient<Database>,
  changeSetId: string,
): Promise<MemoryRetrievalOutcome & { remaining: number }> {
  const { data: cs } = await admin
    .from("change_sets")
    .select("source_id")
    .eq("id", changeSetId)
    .single();

  const { data: items } = await admin
    .from("change_set_items")
    .select("id, atom_payload, atom_embedding")
    .eq("change_set_id", changeSetId);
  if (!items?.length) return { items_processed: 0, neighbors_found: 0, candidates_considered: 0, remaining: 0 };

  // Load the current governed memory (active + approved). This is bounded by
  // typical enterprise memory size; production would page or shard.
  const { data: rows } = await admin
    .from("atoms")
    .select("id, atom_id, name, version, status, knowledge_type, action, applicability, domain_tags, provenance, processes, activities, roles, business_objects, embedding, source_id")
    .in("status", ["active", "approved"]);
  const memory = (rows ?? []) as unknown as NeighborRow[];

  let processed = 0;
  let totalNeighbors = 0;

  for (const item of items) {
    const atom = item.atom_payload as unknown as ProcessAtom;
    if (!atom?.identity) continue;

    // Collapse governed memory to the newest version per atom_id (only surface the
    // active/approved head of each lineage as a neighbor).
    const byLineage = new Map<string, NeighborRow>();
    for (const r of memory) {
      const prev = byLineage.get(r.atom_id);
      if (!prev || r.version > prev.version) byLineage.set(r.atom_id, r);
    }

    const scored: RetrievedNeighbor[] = [];
    const aActionText = actionText(atom);

    for (const r of byLineage.values()) {
      const tagO = tagOverlap(atom.domain_tags, r.domain_tags);
      const filterO =
        overlapCount((atom.applicability?.process?.value ?? []) as string[], r.processes) +
        overlapCount((atom.applicability?.activities?.value ?? []) as string[], r.activities) +
        overlapCount((atom.applicability?.roles?.value ?? []) as string[], r.roles) +
        overlapCount((atom.applicability?.business_objects?.value ?? []) as string[], r.business_objects);
      const lex = jaccard(
        `${atom.identity.name} ${aActionText}`,
        `${r.name} ${rowActionText(r.action)}`,
      );
      // Embedding stored via pgvector serializes to string on read for some drivers;
      // coerce arrays only.
      const emb = Array.isArray(item.atom_embedding) ? (item.atom_embedding as number[]) : null;
      const nemb = Array.isArray(r.embedding) ? r.embedding : null;
      const embScore = cosine(emb, nemb);
      const sameSource = !!cs?.source_id && r.source_id === cs.source_id;

      // Weighted score. All components in [0..1]-ish.
      const score =
        Math.min(tagO, 6) * 0.08 +           // tags
        Math.min(filterO, 6) * 0.09 +        // denorm filter overlap
        lex * 0.30 +                          // lexical
        embScore * 0.35 +                     // embedding
        (sameSource ? 0.15 : 0);              // same source hint

      if (score <= 0.02) continue;
      scored.push({
        atom_db_id: r.id,
        atom_id: r.atom_id,
        name: r.name,
        version: r.version,
        status: r.status,
        signals: {
          tag_overlap: tagO,
          filter_overlap: filterO,
          lexical: +lex.toFixed(3),
          embedding: +embScore.toFixed(3),
          same_source: sameSource,
        },
        score: +score.toFixed(4),
      });
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, TOP_N);
    totalNeighbors += top.length;

    await admin
      .from("change_set_items")
      .update({ neighbors: top as never })
      .eq("id", item.id);
    processed++;
  }

  return { items_processed: processed, neighbors_found: totalNeighbors, candidates_considered: memory.length, remaining: 0 };
}