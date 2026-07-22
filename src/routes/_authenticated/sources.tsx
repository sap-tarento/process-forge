import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Plus, ShieldAlert, Search } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/layout/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { RegisterSourceDialog } from "@/components/sources/RegisterSourceDialog";
import { SourceDetailDrawer } from "@/components/sources/SourceDetailDrawer";
import { STATUS_LABEL, SOURCE_TYPE_LABEL } from "@/lib/source-types";
import { useMyRoles, hasAnyRole } from "@/hooks/useAuth";
import type { Database } from "@/integrations/supabase/types";

type Source = Database["public"]["Tables"]["sources"]["Row"];

export const Route = createFileRoute("/_authenticated/sources")({
  head: () => ({
    meta: [
      { title: "Sources — AtomForge" },
      { name: "description", content: "Registry of policy, SOP, and regulatory documents that feed the compilation pipeline." },
      { property: "og:title", content: "Sources — AtomForge" },
      { property: "og:description", content: "Registry of policy, SOP, and regulatory documents that feed the compilation pipeline." },
    ],
  }),
  component: Page,
});

function Page() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const { data: roles } = useMyRoles();
  const canRegister = hasAnyRole(roles, ["admin", "curator", "policy_owner"]);

  const { data: sources, isLoading } = useQuery({
    queryKey: ["sources"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sources")
        .select("*")
        .order("ingestion_timestamp", { ascending: false });
      if (error) throw error;
      return data as Source[];
    },
  });

  const filtered = (sources ?? []).filter((s) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      s.source_id.toLowerCase().includes(q) ||
      s.title.toLowerCase().includes(q) ||
      (s.owner?.toLowerCase().includes(q) ?? false)
    );
  });

  return (
    <AppShell
      title="Sources"
      description="Registry of policy, SOP, and regulatory documents that feed the compilation pipeline."
      actions={
        canRegister ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Register source
          </Button>
        ) : null
      }
    >
      {sources && sources.length > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by ID, title, or owner"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {filtered.length} of {sources.length}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
          Loading sources…
        </div>
      ) : sources && sources.length > 0 ? (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[220px]">Source ID</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Authority</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ingested</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <TableRow
                  key={s.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(s.id)}
                >
                  <TableCell className="font-mono text-xs">{s.source_id}</TableCell>
                  <TableCell className="max-w-[280px] truncate text-sm">{s.title}</TableCell>
                  <TableCell className="text-xs">{SOURCE_TYPE_LABEL[s.source_type]}</TableCell>
                  <TableCell>
                    <Badge variant={s.authority_class === "NORMATIVE" ? "default" : "secondary"} className="h-4 px-1.5 text-[10px]">
                      {s.authority_class === "DESCRIPTIVE" && <ShieldAlert className="mr-1 h-3 w-3" />}
                      {s.authority_class}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">v{s.version}</TableCell>
                  <TableCell className="text-xs">{STATUS_LABEL[s.status]}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(s.ingestion_timestamp).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          icon={FileText}
          title="No sources registered yet"
          description="Register a policy, SOP, contract, or regulation to begin extracting process atoms. Sources are version-tracked and SHA-256 hashed for provenance."
          action={
            canRegister ? (
              <Button size="sm" onClick={() => setOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Register first source
              </Button>
            ) : undefined
          }
        />
      )}

      <RegisterSourceDialog open={open} onOpenChange={setOpen} />
      <SourceDetailDrawer sourceId={selected} onClose={() => setSelected(null)} />
    </AppShell>
  );
}
