import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/layout/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Settings as SettingsIcon, Save, CheckCircle2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles, hasAnyRole } from "@/hooks/useAuth";
import { updateLlmSettings, savePromptVersion, activatePromptVersion } from "@/lib/settings.functions";
import { loadDemoScenario } from "@/lib/runtime.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — AtomForge" },
      { name: "description", content: "LLM providers, extraction prompts, and workspace configuration." },
      { property: "og:title", content: "Settings — AtomForge" },
      { property: "og:description", content: "LLM providers, extraction prompts, and workspace configuration." },
    ],
  }),
  component: Page,
});

function Page() {
  const { data: roles } = useMyRoles();
  const isAdmin = hasAnyRole(roles, ["admin"]);

  return (
    <AppShell title="Settings" description="LLM providers, extraction prompts, and workspace configuration.">
      {!isAdmin ? (
        <EmptyState
          icon={SettingsIcon}
          title="Admin only"
          description="Only admins can change LLM providers and extraction prompts. Ask a workspace admin for access."
        />
      ) : (
        <div className="space-y-8">
          <LlmSettingsCard />
          <Separator />
          <PromptEditor promptKey="span_detection" title="Span detection prompt" description="Stage 4 — identifies candidate normative spans (explicit and implicit)." />
          <Separator />
          <PromptEditor promptKey="extraction" title="Extraction prompt" description="Stages 5–6 — atomic decomposition + Φ / A / P extraction into ProcessAtom JSON." />
          <Separator />
          <DemoScenarioCard />
        </div>
      )}
    </AppShell>
  );
}

function DemoScenarioCard() {
  const seedFn = useServerFn(loadDemoScenario);
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => seedFn({ data: { confirm: true } }),
    onSuccess: (r) => {
      const o = r as unknown as { atoms_added: number; sources_added: number; vocabulary_added: number; relationships_added: number; already_present: boolean };
      if (o.already_present) toast.success("Demo scenario already loaded (idempotent — no changes).");
      else toast.success(`Loaded demo: +${o.sources_added} sources, +${o.atoms_added} atoms, +${o.vocabulary_added} vocab, +${o.relationships_added} rels.`);
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5"><Sparkles className="h-4 w-4" /> Demo scenario</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-2xl">
            Loads the paper's running example: procurement + finance vocabulary, two normative policy sources
            (with an implicit rule, a heading-scoped section, a threshold, and an exception), five ACTIVE atoms
            with full provenance / evidence / tags / governance / quality, an EXCEPTION_TO relationship, and the{" "}
            <span className="font-mono">more_specific_rule_overrides_general_rule</span> precedence strategy.
            Idempotent — safe to re-run. Does <span className="text-foreground font-medium">not</span> auto-run the LLM pipeline.
          </p>
        </div>
        <Button size="sm" onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? "Loading…" : "Load demo scenario"}
        </Button>
      </div>
    </div>
  );
}

function LlmSettingsCard() {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateLlmSettings);
  const { data, isLoading } = useQuery({
    queryKey: ["llm-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("llm_settings").select("*").eq("singleton", true).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [form, setForm] = useState<{
    provider: string; model: string; embedding_provider: string; embedding_model: string; api_key_secret_name: string;
  } | null>(null);

  const current = form ?? (data ? {
    provider: data.provider,
    model: data.model,
    embedding_provider: data.embedding_provider,
    embedding_model: data.embedding_model,
    api_key_secret_name: data.api_key_secret_name ?? "",
  } : null);

  const mut = useMutation({
    mutationFn: () => updateFn({ data: {
      provider: current!.provider as "lovable" | "openai" | "anthropic" | "custom",
      model: current!.model,
      embedding_provider: current!.embedding_provider,
      embedding_model: current!.embedding_model,
      api_key_secret_name: current!.provider === "lovable" ? null : (current!.api_key_secret_name || null),
    } }),
    onSuccess: () => {
      toast.success("LLM settings updated");
      qc.invalidateQueries({ queryKey: ["llm-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !current) return <div className="text-sm text-muted-foreground">Loading settings…</div>;

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">LLM gateway</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          All chat and embedding calls flow through a single gateway. Non-Lovable providers read the API key from
          the Supabase secret named below (add secrets in Project Settings → Secrets).
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label className="text-xs">Provider</Label>
          <Select value={current.provider} onValueChange={(v) => setForm({ ...current, provider: v })}>
            <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="lovable">Lovable AI (built-in)</SelectItem>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="anthropic">Anthropic</SelectItem>
              <SelectItem value="custom">Custom OpenAI-compatible</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Chat model</Label>
          <Input className="h-8 text-xs mt-1 font-mono" value={current.model} onChange={(e) => setForm({ ...current, model: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Embedding provider</Label>
          <Input className="h-8 text-xs mt-1" value={current.embedding_provider} onChange={(e) => setForm({ ...current, embedding_provider: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Embedding model</Label>
          <Input className="h-8 text-xs mt-1 font-mono" value={current.embedding_model} onChange={(e) => setForm({ ...current, embedding_model: e.target.value })} />
        </div>
        {current.provider !== "lovable" && (
          <div className="md:col-span-2">
            <Label className="text-xs">Supabase secret name (API key)</Label>
            <Input className="h-8 text-xs mt-1 font-mono" placeholder="e.g. OPENAI_API_KEY" value={current.api_key_secret_name} onChange={(e) => setForm({ ...current, api_key_secret_name: e.target.value })} />
            <p className="mt-1 text-[11px] text-muted-foreground">Add this secret in Project Settings → Secrets. The gateway reads it server-side; the key never touches the browser.</p>
          </div>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <Button size="sm" onClick={() => mut.mutate()} disabled={mut.isPending}>
          <Save className="mr-1.5 h-3.5 w-3.5" /> Save
        </Button>
      </div>
    </div>
  );
}

interface PromptVersion { id: string; prompt_key: string; version: number; template: string; active: boolean; created_at: string }

function PromptEditor({ promptKey, title, description }: { promptKey: string; title: string; description: string }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(savePromptVersion);
  const activateFn = useServerFn(activatePromptVersion);
  const [editing, setEditing] = useState<string | null>(null);

  const { data: versions } = useQuery({
    queryKey: ["prompt-versions", promptKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompt_versions")
        .select("*")
        .eq("prompt_key", promptKey)
        .order("version", { ascending: false });
      if (error) throw error;
      return data as PromptVersion[];
    },
  });

  const active = versions?.find((v) => v.active);
  const template = editing ?? active?.template ?? "";

  const saveMut = useMutation({
    mutationFn: () => saveFn({ data: { prompt_key: promptKey, template, activate: true } }),
    onSuccess: (r) => {
      toast.success(`Saved prompt v${r.version}`);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["prompt-versions", promptKey] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activateMut = useMutation({
    mutationFn: (version: number) => activateFn({ data: { prompt_key: promptKey, version } }),
    onSuccess: () => {
      toast.success("Version activated");
      qc.invalidateQueries({ queryKey: ["prompt-versions", promptKey] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">prompt_key: {promptKey}</p>
        </div>
        {active && <Badge>v{active.version} active</Badge>}
      </div>

      <Textarea
        className="mt-3 font-mono text-[11px] min-h-[240px]"
        value={template}
        onChange={(e) => setEditing(e.target.value)}
      />

      <div className="mt-3 flex items-center justify-between">
        <div className="flex flex-wrap gap-1.5">
          {(versions ?? []).map((v) => (
            <button
              key={v.id}
              onClick={() => setEditing(v.template)}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] ${v.active ? "border-primary bg-primary/5 text-primary" : "border-border hover:bg-muted/50"}`}
              title={new Date(v.created_at).toLocaleString()}
            >
              v{v.version}
              {v.active && <CheckCircle2 className="h-3 w-3" />}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {editing !== null && active && editing !== active.template && (
            <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Discard</Button>
          )}
          {(versions ?? []).some((v) => !v.active && editing === v.template) && (
            <Button size="sm" variant="outline" onClick={() => {
              const v = (versions ?? []).find((x) => editing === x.template);
              if (v) activateMut.mutate(v.version);
            }}>Activate this version</Button>
          )}
          <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !template.trim() || template === active?.template}>
            <Save className="mr-1.5 h-3.5 w-3.5" /> Save as new version
          </Button>
        </div>
      </div>
    </div>
  );
}
