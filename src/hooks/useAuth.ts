import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];

const ROLE_ORDER: AppRole[] = ["admin", "policy_owner", "curator", "reviewer", "viewer"];

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  return { session, user: session?.user ?? null as User | null, ready };
}

export function useMyRoles() {
  const { user } = useSession();
  return useQuery({
    queryKey: ["my-roles", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<AppRole[]> => {
      const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.role);
    },
  });
}

export function primaryRole(roles: AppRole[] | undefined): AppRole | null {
  if (!roles?.length) return null;
  for (const r of ROLE_ORDER) if (roles.includes(r)) return r;
  return null;
}

export function hasAnyRole(roles: AppRole[] | undefined, allowed: AppRole[]): boolean {
  if (!roles) return false;
  return roles.some((r) => allowed.includes(r));
}

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Admin",
  policy_owner: "Policy owner",
  curator: "Curator",
  reviewer: "Reviewer",
  viewer: "Viewer",
};
