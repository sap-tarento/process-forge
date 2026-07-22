import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { AtomDetail, useAtomRelationships } from "@/components/atom/AtomDetail";
import { rowToAtom, ATOM_COLUMNS } from "@/lib/atom-mapper";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LifecycleBadge } from "@/components/atom/AtomStatusBadge";

export const Route = createFileRoute("/_authenticated/atoms/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Atom ${params.id.slice(0, 8)} — AtomForge` },
      { name: "description", content: "Governed process atom detail: identity, applicability, action, purpose, provenance, governance, and quality." },
      { property: "og:title", content: `Atom detail — AtomForge` },
      { property: "og:description", content: "12-component view of a compiled process atom." },
    ],
  }),
  component: Page,
});

function Page() {
  const { id } = Route.useParams();

  const { data: atom, isLoading } = useQuery({
    queryKey: ["atom", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("atoms").select(ATOM_COLUMNS).eq("id", id).maybeSingle();
      if (error) throw error;
      if (!data) throw notFound();
      return rowToAtom(data as never);
    },
  });

  const { data: versions } = useQuery({
    queryKey: ["atom-versions", atom?.identity.atom_id],
    enabled: !!atom,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("atoms")
        .select("id, version, status, valid_from, valid_to, transaction_time")
        .eq("atom_id", atom!.identity.atom_id)
        .order("version", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: relationships } = useAtomRelationships(atom?.db_id);

  return (
    <AppShell
      title={atom ? atom.identity.name : "Atom"}
      description={atom ? atom.identity.atom_id : "Loading…"}
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link to="/memory"><ArrowLeft className="mr-1 h-3.5 w-3.5" />Back to memory</Link>
        </Button>
      }
    >
      {isLoading || !atom ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <Tabs defaultValue="detail">
          <TabsList>
            <TabsTrigger value="detail">12-component view</TabsTrigger>
            <TabsTrigger value="versions">Version history</TabsTrigger>
          </TabsList>
          <TabsContent value="detail" className="mt-4">
            <AtomDetail atom={atom} relationships={relationships} />
          </TabsContent>
          <TabsContent value="versions" className="mt-4">
            <div className="rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 text-left">Version</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">valid_from</th>
                    <th className="px-3 py-2 text-left">valid_to</th>
                    <th className="px-3 py-2 text-left">transaction_time</th>
                  </tr>
                </thead>
                <tbody>
                  {(versions ?? []).map((v) => (
                    <tr key={v.id} className="border-b border-border/50 last:border-b-0">
                      <td className="px-3 py-2 font-mono">v{v.version}</td>
                      <td className="px-3 py-2"><LifecycleBadge status={v.status} /></td>
                      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{v.valid_from ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{v.valid_to ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{v.transaction_time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-border p-3 text-[11px] text-muted-foreground">
                Bitemporal: superseded versions remain queryable for audit — old rules can be replayed at any past business-time or system-time.
              </div>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </AppShell>
  );
}