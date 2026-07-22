import type { ProcessAtom } from "@/types/atom";

type AtomRow = {
  id: string;
  atom_id: string;
  name: string;
  version: number;
  status: ProcessAtom["version"]["status"];
  transaction_time: string;
  valid_from: string | null;
  valid_to: string | null;
  knowledge_type: ProcessAtom["knowledge_type"];
  applicability: unknown;
  action: unknown;
  purpose: unknown;
  domain_tags: unknown;
  provenance: unknown;
  governance: unknown;
  quality: unknown;
};

export function rowToAtom(row: AtomRow): ProcessAtom & { db_id: string } {
  return {
    db_id: row.id,
    identity: { atom_id: row.atom_id, name: row.name },
    version: {
      version: row.version,
      status: row.status,
      transaction_time: row.transaction_time,
      valid_from: row.valid_from,
      valid_to: row.valid_to,
    },
    knowledge_type: row.knowledge_type,
    applicability: (row.applicability as ProcessAtom["applicability"]) ?? ({} as ProcessAtom["applicability"]),
    action: (row.action as ProcessAtom["action"]) ?? ({ modality: "MUST", actor: "", operation: "", object: "", on_noncompliance: [] } as ProcessAtom["action"]),
    purpose: (row.purpose as ProcessAtom["purpose"]) ?? ({ text: "", derivation: "unknown", confidence: 0, execution_authoritative: false }),
    domain_tags: (row.domain_tags as ProcessAtom["domain_tags"]) ?? ({} as ProcessAtom["domain_tags"]),
    provenance: (row.provenance as ProcessAtom["provenance"]) ?? ({} as ProcessAtom["provenance"]),
    governance: (row.governance as ProcessAtom["governance"]) ?? ({} as ProcessAtom["governance"]),
    quality: (row.quality as ProcessAtom["quality"]) ?? ({ validations: [] } as ProcessAtom["quality"]),
  };
}

export const ATOM_COLUMNS = "id, atom_id, name, version, status, transaction_time, valid_from, valid_to, knowledge_type, applicability, action, purpose, domain_tags, provenance, governance, quality, processes, activities, roles, business_objects, source_id, created_at, updated_at";