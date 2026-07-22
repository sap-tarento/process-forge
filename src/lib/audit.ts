import { supabase } from "@/integrations/supabase/client";

export async function recordAudit(opts: {
  event_type: string;
  entity_type: string;
  entity_id?: string | null;
  payload?: Record<string, unknown>;
}) {
  const { data: userRes } = await supabase.auth.getUser();
  await supabase.from("audit_events").insert({
    event_type: opts.event_type,
    entity_type: opts.entity_type,
    entity_id: opts.entity_id ?? null,
    actor: userRes.user?.id ?? null,
    payload: opts.payload ?? {},
  });
}
