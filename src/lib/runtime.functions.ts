import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RetrievalInput = z.object({
  process: z.string().nullable().optional(),
  activity: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  organizational_unit: z.string().nullable().optional(),
  business_object: z.string().nullable().optional(),
  business_object_attributes: z.record(z.string(), z.unknown()).optional(),
  case_state: z.record(z.string(), z.unknown()).optional(),
  as_of_time: z.string().nullable().optional(),
});

export const retrieveAtomsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => RetrievalInput.parse(v))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { retrieveAtoms } = await import("./pipeline/retrieve-atoms.server");
    return await retrieveAtoms(supabaseAdmin, data);
  });

const DemoSeedInput = z.object({ confirm: z.literal(true) });

export const loadDemoScenario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => DemoSeedInput.parse(v))
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden: admin role required");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { seedDemoScenario } = await import("./pipeline/demo-seed.server");
    return await seedDemoScenario(supabaseAdmin, context.userId);
  });