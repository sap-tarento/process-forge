/**
 * Public retrieval endpoint. External agents POST an execution context and
 * receive the same 8-step retrieval trace + ranked atoms the in-app Runtime
 * page shows.
 *
 * Auth: if the `ATOMFORGE_RUNTIME_TOKEN` secret is set, callers must send a
 * matching `Authorization: Bearer <token>` header. If unset, the endpoint is
 * open (self-host default).
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Input = z.object({
  process: z.string().nullable().optional(),
  activity: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  organizational_unit: z.string().nullable().optional(),
  business_object: z.string().nullable().optional(),
  business_object_attributes: z.record(z.string(), z.unknown()).optional(),
  case_state: z.record(z.string(), z.unknown()).optional(),
  as_of_time: z.string().nullable().optional(),
});

function cors(status: number, body?: unknown): Response {
  const headers: Record<string, string> = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
  };
  if (body === undefined) return new Response(null, { status, headers });
  headers["content-type"] = "application/json";
  return new Response(JSON.stringify(body), { status, headers });
}

export const Route = createFileRoute("/api/public/retrieve")({
  server: {
    handlers: {
      OPTIONS: async () => cors(204),
      GET: async () => cors(200, {
        endpoint: "POST /api/public/retrieve",
        content_type: "application/json",
        body_schema: {
          process: "string | null (optional)",
          activity: "string | null (optional)",
          role: "string | null (optional)",
          organizational_unit: "string | null (optional)",
          business_object: "string | null (optional)",
          business_object_attributes: "object (optional) — key/value context",
          case_state: "object (optional) — key/value case state",
          as_of_time: "ISO datetime (optional) — bitemporal query",
        },
        auth: "Bearer token in Authorization header, matching secret ATOMFORGE_RUNTIME_TOKEN if configured.",
      }),
      POST: async ({ request }) => {
        const expected = process.env.ATOMFORGE_RUNTIME_TOKEN;
        if (expected) {
          const got = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
          if (got !== expected) return cors(401, { error: "unauthorized" });
        }
        let payload: unknown;
        try { payload = await request.json(); } catch { return cors(400, { error: "invalid JSON body" }); }
        const parsed = Input.safeParse(payload);
        if (!parsed.success) return cors(400, { error: "invalid payload", details: parsed.error.flatten() });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { retrieveAtoms } = await import("@/lib/pipeline/retrieve-atoms.server");
        try {
          const result = await retrieveAtoms(supabaseAdmin, parsed.data as never);
          return cors(200, result);
        } catch (e) {
          return cors(500, { error: e instanceof Error ? e.message : "internal error" });
        }
      },
    },
  },
});